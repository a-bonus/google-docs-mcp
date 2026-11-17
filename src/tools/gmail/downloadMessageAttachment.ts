import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { getGmailClient } from '../../clients.js';
import {
  WINDOWS_CONFIG_FILE,
  WINDOWS_DEVICE,
  ensureWithinDownloadRoots,
  looksLikeShortName,
  unsafeSegmentBelowRoot,
} from '../drive/savePathGuard.js';
import { collectAttachments } from './helpers.js';

// Gmail accepts incoming messages up to 50 MB, so no single attachment can be
// larger. Anything over this did not come from Gmail as documented and is
// refused before it is decoded or written.
export const ATTACHMENT_DOWNLOAD_BYTE_LIMIT = 50 * 1024 * 1024;

const BASE64URL = /^[A-Za-z0-9_-]*={0,2}$/;

// Bytes, not characters: ext4 and APFS cap a name at 255 bytes of UTF-8.
const MAX_FILENAME_BYTES = 200;

function truncateUtf8(value: string, maxBytes: number): string {
  let out = '';
  let bytes = 0;
  for (const char of value) {
    const size = Buffer.byteLength(char, 'utf8');
    if (bytes + size > maxBytes) break;
    out += char;
    bytes += size;
  }
  return out;
}

/**
 * Turns an attachment's file name, which the sender controls, into a single
 * safe path segment: no directory parts; no control, invisible (bidi override,
 * zero-width) or Windows-invalid characters; no leading dots (so no `.npmrc`
 * or `.envrc`); no trailing dots or spaces; no Windows device names, and no
 * `desktop.ini` or `autorun.inf`; on
 * Windows no 8.3 short-name shape (`Report~1.pdf` becomes `Report_1.pdf`); at
 * most 200 bytes of UTF-8 with the extension kept. Falls back to `attachment`
 * when nothing usable is left.
 */
export function sanitizeAttachmentFilename(
  name: string | null | undefined,
  platform: NodeJS.Platform = process.platform
): string {
  let cleaned = (name ?? '')
    .replace(/[\x00-\x1F\x7F\\/:*?"<>|]|[\p{Cf}\p{Zl}\p{Zp}]/gu, '_')
    .trim()
    .replace(/[. ]+$/, '')
    .replace(/^\.+/, (dots) => '_'.repeat(dots.length));
  if (!cleaned) return 'attachment';
  if (WINDOWS_DEVICE.test(cleaned) || WINDOWS_CONFIG_FILE.test(cleaned)) cleaned = `_${cleaned}`;
  // The save path guard refuses this shape on Windows; map it rather than fail
  // over a name the caller never chose.
  if (platform === 'win32' && looksLikeShortName(cleaned)) {
    cleaned = cleaned.replace(/~(\d+)(?=\.[^.]*$|$)/, '_$1');
  }
  if (Buffer.byteLength(cleaned, 'utf8') > MAX_FILENAME_BYTES) {
    const ext = truncateUtf8(path.extname(cleaned), 20);
    const stem = truncateUtf8(cleaned, MAX_FILENAME_BYTES - Buffer.byteLength(ext, 'utf8'));
    cleaned = stem.replace(/[. ]+$/, '') + ext;
  }
  return cleaned;
}

/**
 * Decodes Gmail's base64url attachment data, refusing anything malformed or
 * over the size limit before decoding it. An empty attachment is only
 * accepted when Gmail also reports its size as 0.
 */
export function decodeAttachmentData(
  data: string | null | undefined,
  reportedSize?: number | null
): Buffer {
  if (!data) {
    if (reportedSize === 0) return Buffer.alloc(0);
    throw new UserError('Gmail returned no data for this attachment.');
  }
  // A length of 4n+1 cannot come out of any base64 encoder.
  if (!BASE64URL.test(data) || data.replace(/=+$/, '').length % 4 === 1) {
    throw new UserError('Gmail returned attachment data that is not valid base64url.');
  }
  // base64 grows data by 4/3, so this bounds the decoded size without decoding.
  if (Math.floor((data.length * 3) / 4) > ATTACHMENT_DOWNLOAD_BYTE_LIMIT + 2) {
    throw new UserError(
      `Attachment is over the ${ATTACHMENT_DOWNLOAD_BYTE_LIMIT}-byte limit and was not saved.`
    );
  }
  const bytes = Buffer.from(data, 'base64url');
  if (bytes.length > ATTACHMENT_DOWNLOAD_BYTE_LIMIT) {
    throw new UserError(
      `Attachment is over the ${ATTACHMENT_DOWNLOAD_BYTE_LIMIT}-byte limit and was not saved.`
    );
  }
  return bytes;
}

const execFileAsync = promisify(execFile);

/**
 * Best effort: tags the file the way a browser tags a download, so the OS
 * warns before an attachment such as `invoice.pdf.app` or `.exe` is run.
 * macOS gets the `com.apple.quarantine` attribute, Windows a Zone.Identifier
 * stream (Mark of the Web). Never fails the download.
 */
export async function markAsDownloaded(
  target: string,
  platform: NodeJS.Platform = process.platform
): Promise<boolean> {
  try {
    if (platform === 'darwin') {
      const stamp = Math.floor(Date.now() / 1000).toString(16);
      await execFileAsync(
        '/usr/bin/xattr',
        // -s: tag a symlink itself, never the file it points to.
        ['-s', '-w', 'com.apple.quarantine', `0081;${stamp};google-docs-mcp;`, target],
        { timeout: 5000 }
      );
      return true;
    }
    if (platform === 'win32') {
      await fsp.writeFile(`${target}:Zone.Identifier`, '[ZoneTransfer]\r\nZoneId=3\r\n');
      return true;
    }
  } catch {
    /* tagging is a courtesy; the file is saved either way */
  }
  return false;
}

const BOUNDARY_MESSAGE =
  'savePath must stay inside the allowed download directory (GOOGLE_DOCS_MCP_DOWNLOAD_ROOTS).';

function realpathOrResolve(target: string): string {
  try {
    return fs.realpathSync(target);
  } catch {
    return path.resolve(target);
  }
}

/**
 * Parses GOOGLE_DOCS_MCP_DOWNLOAD_ROOTS for attachment downloads. Unlike
 * downloadFile, which falls back to the working directory, this fails closed:
 * attachment bytes and names come from the sender, and the hidden-segment
 * guard only helps when the root is a folder meant for downloads.
 *
 * @throws UserError when unset, when an entry is relative, or when an entry
 *   contains the home directory (which would let a sender write into
 *   ~/Library/LaunchAgents or ~/Desktop).
 */
export function parseAttachmentDownloadRoots(
  value = process.env.GOOGLE_DOCS_MCP_DOWNLOAD_ROOTS
): string[] {
  const entries = (value ?? '')
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (entries.length === 0) {
    throw new UserError(
      'Attachment downloads are disabled because GOOGLE_DOCS_MCP_DOWNLOAD_ROOTS is not set. Set ' +
        'it in the MCP server env to an absolute folder that only holds downloads, delimited by ' +
        '":" (";" on Windows).'
    );
  }
  const home = realpathOrResolve(os.homedir());
  return entries.map((entry) => {
    if (!path.isAbsolute(entry)) {
      throw new UserError(
        `GOOGLE_DOCS_MCP_DOWNLOAD_ROOTS entries must be absolute paths for attachment downloads, got "${entry}".`
      );
    }
    const root = realpathOrResolve(entry);
    const relative = path.relative(root, home);
    const outside =
      relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
    if (!outside) {
      throw new UserError(
        `GOOGLE_DOCS_MCP_DOWNLOAD_ROOTS entry "${entry}" contains the home directory, so a sender ` +
          'could write anywhere in it. List a folder that only holds downloads.'
      );
    }
    return path.resolve(entry);
  });
}

/**
 * Confines a destination: inside a download root, and no unsafe segment below
 * it. The error never echoes resolved paths or roots, so it cannot be used to
 * probe the disk.
 */
function confine(target: string, roots: string[]): string {
  let resolved: string;
  try {
    resolved = ensureWithinDownloadRoots(target, roots);
  } catch {
    throw new UserError(BOUNDARY_MESSAGE);
  }
  // Attachment bytes are attacker content; keep them out of hidden config such
  // as .git/hooks or .npmrc, where they would be loaded or executed.
  const unsafe = unsafeSegmentBelowRoot(resolved, roots);
  if (unsafe) {
    throw new UserError(
      `savePath may not use "${unsafe.segment}": it ${unsafe.problem}. Hidden files and folders ` +
        'such as .git or .npmrc, and desktop.ini or autorun.inf, are refused because attachments ' +
        'are untrusted.'
    );
  }
  return resolved;
}

/** Refuses a symlink or directory at the destination, and an existing file unless overwriting. */
function checkDestination(target: string, overwrite: boolean): void {
  // lstat, not exists: a dangling symlink must not slip through as "absent".
  const existing = fs.lstatSync(target, { throwIfNoEntry: false });
  if (!existing) return;
  if (existing.isSymbolicLink()) {
    throw new UserError(`"${target}" is a symbolic link. Choose another savePath.`);
  }
  if (existing.isDirectory()) throw new UserError(`"${target}" is a directory.`);
  if (!overwrite) {
    throw new UserError(
      `"${target}" already exists. Pass overwrite: true to replace it, or choose another savePath.`
    );
  }
}

/**
 * Writes `bytes` to a new temp file next to `target`, tags it as downloaded,
 * then moves it into place. Returns whether the tag was set.
 *
 * - The parent is confined again before it is created and again before the
 *   write, which narrows the window for swapping it (or an ancestor) for a
 *   symlink while the attachment downloads.
 * - The tag goes on the temp file, so the file is never in place untagged and
 *   a symlink swapped in at `target` cannot redirect the tag.
 * - Without overwrite, link() places the file atomically and fails if
 *   anything (a file, a dangling symlink) appeared at `target` meanwhile.
 * - With overwrite, rename() replaces the directory entry: a symlink there is
 *   replaced rather than followed, other hard links to the old file keep the
 *   old content, the old mode (an exec bit, say) is not inherited, and a
 *   failed write never leaves the old file truncated.
 */
async function writeAtomically(
  target: string,
  bytes: Buffer,
  overwrite: boolean,
  roots: string[]
): Promise<boolean> {
  const dir = path.dirname(target);
  confine(dir, roots);
  await fsp.mkdir(dir, { recursive: true });
  confine(dir, roots);
  checkDestination(target, overwrite);

  const temp = path.join(dir, `.${randomBytes(8).toString('hex')}.download-part`);
  const { O_WRONLY, O_CREAT, O_EXCL, O_NOFOLLOW = 0 } = fs.constants;
  const exclusive = O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW;
  try {
    const handle = await fsp.open(temp, exclusive, 0o644);
    try {
      await handle.writeFile(bytes);
    } finally {
      await handle.close();
    }
    const tagged = await markAsDownloaded(temp);
    if (overwrite) {
      await fsp.rename(temp, target);
      return tagged;
    }
    try {
      await fsp.link(temp, target);
    } catch (linkError: any) {
      // Some filesystems (FAT, exFAT, some network shares) have no hard links.
      const noHardLinks = ['EPERM', 'EACCES', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS'];
      if (!noHardLinks.includes(linkError?.code)) throw linkError;
      const out = await fsp.open(target, exclusive, 0o644);
      try {
        try {
          await out.writeFile(bytes);
        } finally {
          await out.close();
        }
      } catch (fallbackError) {
        // O_EXCL means this call created the file, so a partial one is ours to remove.
        await fsp.rm(target, { force: true });
        throw fallbackError;
      }
      return markAsDownloaded(target);
    }
    return tagged;
  } catch (writeError: any) {
    if (writeError?.code === 'EEXIST') {
      throw new UserError(
        `"${target}" already exists. Pass overwrite: true to replace it, or choose another savePath.`
      );
    }
    if (writeError?.code === 'ELOOP') {
      throw new UserError(`"${target}" is a symbolic link. Choose another savePath.`);
    }
    if (writeError?.code === 'EISDIR') throw new UserError(`"${target}" is a directory.`);
    if (writeError instanceof UserError) throw writeError;
    // Raw filesystem errors carry full paths; report the code only.
    throw new UserError(`Could not save the attachment (${writeError?.code ?? 'unknown error'}).`);
  } finally {
    await fsp.rm(temp, { force: true });
  }
}

function isDirectoryTarget(savePath: string): boolean {
  if (savePath.endsWith('/') || savePath.endsWith(path.sep)) return true;
  try {
    return fs.statSync(savePath).isDirectory();
  } catch {
    return false;
  }
}

const DownloadMessageAttachmentParameters = z
  .strictObject({
    messageId: z.string().min(1).describe('The Gmail message ID, from listMessages or getMessage.'),
    partId: z
      .string()
      .min(1)
      .optional()
      .describe(
        'The partId of the attachment from getMessage. Preferred: Gmail issues a new ' +
          'attachmentId on every fetch, so partId is the stable way to pick an attachment.'
      ),
    attachmentId: z
      .string()
      .min(1)
      .optional()
      .describe(
        'The attachmentId from getMessage. Only used when partId is not given; the file name ' +
          'and MIME type can then only be found if the ID still matches.'
      ),
    savePath: z
      .string()
      .min(1)
      .describe(
        'Local file path, or an existing directory (or a path ending in "/"), to save to. In a ' +
          "directory the attachment's sanitized file name is used. Must stay inside " +
          'GOOGLE_DOCS_MCP_DOWNLOAD_ROOTS, which must be set for this tool. Hidden files and ' +
          'folders (any part starting with ".") are refused.'
      ),
    overwrite: z
      .boolean()
      .optional()
      .default(false)
      .describe('Replace an existing file at the destination. Defaults to false.'),
  })
  .refine((args) => args.partId !== undefined || args.attachmentId !== undefined, {
    message: 'Pass partId (preferred) or attachmentId from getMessage.',
  });

export function register(server: FastMCP) {
  server.addTool({
    name: 'downloadMessageAttachment',
    description:
      'Downloads one attachment of a Gmail message to a local file. Get messageId and partId ' +
      '(or attachmentId) from getMessage. Returns the saved path, size in bytes, and MIME type. ' +
      'Will not overwrite an existing file unless overwrite is true. Requires ' +
      'GOOGLE_DOCS_MCP_DOWNLOAD_ROOTS to be set. Not available in remote (httpStream) mode.',
    parameters: DownloadMessageAttachmentParameters,
    execute: async (args, { log }) => {
      if (process.env.MCP_TRANSPORT === 'httpStream') {
        // In remote mode a path names a file on the shared server, not the caller's machine.
        throw new UserError(
          'downloadMessageAttachment is not available when the server runs in httpStream mode.'
        );
      }
      if (process.platform === 'win32' && /^[\\/]{2}/.test(args.savePath)) {
        // Even a stat of a UNC path opens an SMB connection to the named host.
        throw new UserError('savePath may not be a network (UNC) path.');
      }

      // Local checks first: nothing outside the roots is stat'ed, and no API
      // call is made for a destination that would be refused anyway.
      const roots = parseAttachmentDownloadRoots();
      const savePath = confine(args.savePath, roots);
      const intoDirectory = isDirectoryTarget(args.savePath);
      if (!intoDirectory) checkDestination(savePath, args.overwrite);

      const gmail = await getGmailClient();
      log.info(`Downloading attachment from Gmail message ${args.messageId}`);

      try {
        // File name, MIME type and size live on the message part, not on the
        // attachment resource.
        const message = await gmail.users.messages.get({
          userId: 'me',
          id: args.messageId,
          format: 'full',
        });
        const parts = collectAttachments(message.data.payload);
        const part =
          args.partId !== undefined
            ? parts.find((p) => p.partId === args.partId)
            : parts.find((p) => p.attachmentId === args.attachmentId);
        if (args.partId !== undefined && !part?.attachmentId) {
          throw new UserError(
            `Message ${args.messageId} has no attachment with partId "${args.partId}".`
          );
        }
        // With partId, download the ID Gmail just issued for that part, so the
        // bytes always belong to the part whose name and MIME type are reported.
        const attachmentId = args.partId !== undefined ? part!.attachmentId! : args.attachmentId!;

        if (part && part.size > ATTACHMENT_DOWNLOAD_BYTE_LIMIT) {
          throw new UserError(
            `Attachment is ${part.size} bytes, over the ${ATTACHMENT_DOWNLOAD_BYTE_LIMIT}-byte limit.`
          );
        }

        let target = savePath;
        if (intoDirectory) {
          if (!part) {
            throw new UserError(
              'Could not match attachmentId to a file name (Gmail issues a new attachmentId on ' +
                'every fetch). Pass partId from getMessage, or give savePath as a full file path.'
            );
          }
          // The file name comes from the sender: sanitize, then confine again.
          target = confine(path.join(savePath, sanitizeAttachmentFilename(part.filename)), roots);
          checkDestination(target, args.overwrite);
        }

        const response = await gmail.users.messages.attachments.get({
          userId: 'me',
          messageId: args.messageId,
          id: attachmentId,
        });
        const bytes = decodeAttachmentData(response.data.data, response.data.size);

        const markedAsDownloaded = await writeAtomically(target, bytes, args.overwrite, roots);

        log.info(`Saved ${bytes.length} bytes to ${target}`);
        return JSON.stringify(
          {
            savedTo: target,
            filename: path.basename(target),
            mimeType: part?.mimeType ?? 'application/octet-stream',
            sizeBytes: bytes.length,
            markedAsDownloaded,
          },
          null,
          2
        );
      } catch (error: any) {
        log.error(`Error downloading Gmail attachment: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        if (error.code === 404)
          throw new UserError(
            `Gmail message or attachment not found (message ID: ${args.messageId}).`
          );
        if (error.code === 403)
          throw new UserError('Permission denied. Confirm the gmail.modify scope was granted.');
        throw new UserError(
          `Failed to download Gmail attachment: ${error.message || 'Unknown error'}`
        );
      }
    },
  });
}

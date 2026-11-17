import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { UserError } from 'fastmcp';
import { getGmailClient } from '../../clients.js';
import {
  register,
  sanitizeAttachmentFilename,
  decodeAttachmentData,
  markAsDownloaded,
  parseAttachmentDownloadRoots,
  ATTACHMENT_DOWNLOAD_BYTE_LIMIT,
} from './downloadMessageAttachment.js';

vi.mock('../../clients.js', () => ({
  getGmailClient: vi.fn(),
}));

const mockLog = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };

type Tool = { parameters: any; execute: (args: any, context: any) => Promise<string> };

function loadTool(): Tool {
  let tool: Tool | undefined;
  register({ addTool: (config: Tool) => (tool = config) } as any);
  return tool!;
}

/** Validates args with the tool's own Zod schema (applies defaults), then executes. */
async function run(args: Record<string, unknown>) {
  const tool = loadTool();
  return JSON.parse(await tool.execute(tool.parameters.parse(args), { log: mockLog }));
}

const PDF = Buffer.from('%PDF-1.4 test attachment bytes\n');
const SCRIPT = Buffer.from('#!/bin/sh\necho payload\n');

/** Two attachments, so a partId/attachmentId mismatch would be visible. */
function messagePayload(filename = 'report.pdf', pdfSize = PDF.length) {
  return {
    mimeType: 'multipart/mixed',
    parts: [
      { partId: '0', mimeType: 'text/plain', filename: '', body: { data: 'aGk' } },
      {
        partId: '1',
        mimeType: 'application/pdf',
        filename,
        body: { attachmentId: 'att-pdf', size: pdfSize },
      },
      {
        partId: '2',
        mimeType: 'text/x-shellscript',
        filename: 'run.sh',
        body: { attachmentId: 'att-script', size: SCRIPT.length },
      },
    ],
  };
}

let root: string;
let messagesGet: ReturnType<typeof vi.fn>;
let attachmentsGet: ReturnType<typeof vi.fn>;
const originalRoots = process.env.GOOGLE_DOCS_MCP_DOWNLOAD_ROOTS;
const originalTransport = process.env.MCP_TRANSPORT;

function mockGmail(
  opts: { filename?: string; pdfSize?: number; data?: string | null; size?: number } = {}
) {
  messagesGet = vi.fn(async () => ({
    data: { id: 'msg-1', payload: messagePayload(opts.filename, opts.pdfSize) },
  }));
  attachmentsGet = vi.fn(async ({ id }: { id: string }) => {
    const bytes = id === 'att-script' ? SCRIPT : PDF;
    return {
      data: {
        size: opts.size ?? bytes.length,
        data: opts.data === undefined ? bytes.toString('base64url') : opts.data,
      },
    };
  });
  vi.mocked(getGmailClient).mockResolvedValue({
    users: { messages: { get: messagesGet, attachments: { get: attachmentsGet } } },
  } as any);
}

function tempDir(prefix: string) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

beforeEach(() => {
  vi.clearAllMocks();
  root = tempDir('gmail-attachment-');
  process.env.GOOGLE_DOCS_MCP_DOWNLOAD_ROOTS = root;
  delete process.env.MCP_TRANSPORT;
  mockGmail();
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  if (originalRoots === undefined) delete process.env.GOOGLE_DOCS_MCP_DOWNLOAD_ROOTS;
  else process.env.GOOGLE_DOCS_MCP_DOWNLOAD_ROOTS = originalRoots;
  if (originalTransport === undefined) delete process.env.MCP_TRANSPORT;
  else process.env.MCP_TRANSPORT = originalTransport;
});

describe('sanitizeAttachmentFilename', () => {
  it.each([
    ['report.pdf', 'report.pdf'],
    ['Rēķins 2026.pdf', 'Rēķins 2026.pdf'],
    ['../../etc/passwd', '___.._etc_passwd'],
    ['..\\..\\boot.ini', '___.._boot.ini'],
    ['a\r\nb.txt', 'a__b.txt'],
    ['.npmrc', '_npmrc'],
    ['invoice‮fdp.exe', 'invoice_fdp.exe'],
    ['a​b.pdf', 'a_b.pdf'],
    ['file.txt:stream', 'file.txt_stream'],
    ['name. . .', 'name'],
    ['CON', '_CON'],
    ['nul.txt', '_nul.txt'],
    ['COM¹', '_COM¹'],
    ['desktop.ini', '_desktop.ini'],
    ['AUTORUN.INF', '_AUTORUN.INF'],
    ['desktop.ini.txt', 'desktop.ini.txt'],
    ['..', 'attachment'],
    ['.', 'attachment'],
    ['', 'attachment'],
    [null, 'attachment'],
  ])('turns %j into %j', (input, expected) => {
    expect(sanitizeAttachmentFilename(input)).toBe(expected);
  });

  it.each([
    ['Report~1.pdf', 'Report_1.pdf'],
    ['GIT~1', 'GIT_1'],
    ['PROGR~12', 'PROGR_12'],
    ['backup~2024.zip', 'backup~2024.zip'],
    ['a~1b.pdf', 'a~1b.pdf'],
  ])('maps the 8.3 short-name shape %j to %j on Windows only', (input, expected) => {
    expect(sanitizeAttachmentFilename(input, 'win32')).toBe(expected);
    expect(sanitizeAttachmentFilename(input, 'linux')).toBe(input);
  });

  it('caps long names at 200 bytes and keeps the extension', () => {
    const name = sanitizeAttachmentFilename('a'.repeat(500) + '.pdf');
    expect(Buffer.byteLength(name)).toBe(200);
    expect(name.endsWith('.pdf')).toBe(true);
  });

  it('counts UTF-8 bytes and never splits a character', () => {
    const name = sanitizeAttachmentFilename('文'.repeat(100) + '😀'.repeat(20) + '.pdf');
    expect(Buffer.byteLength(name)).toBeLessThanOrEqual(200);
    expect(name).not.toMatch(/�/);
    expect(Buffer.from(name).toString()).toBe(name);
    expect(name.endsWith('.pdf')).toBe(true);
  });
});

describe('parseAttachmentDownloadRoots', () => {
  it.each([[''], ['  '], [path.delimiter]])('fails closed for %j', (value) => {
    expect(() => parseAttachmentDownloadRoots(value)).toThrow(
      /disabled because GOOGLE_DOCS_MCP_DOWNLOAD_ROOTS is not set/
    );
  });

  it('refuses a relative entry', () => {
    expect(() => parseAttachmentDownloadRoots('downloads')).toThrow(/must be absolute/);
  });

  it.each([
    ['the home directory', () => os.homedir()],
    ['a parent of it', () => path.dirname(os.homedir())],
    ['the filesystem root', () => path.parse(os.homedir()).root],
  ])('refuses %s, which would expose the whole home folder', (_label, entry) => {
    expect(() => parseAttachmentDownloadRoots(entry())).toThrow(/contains the home directory/);
  });

  it('accepts folders inside or beside the home directory', () => {
    const inside = path.join(os.homedir(), 'Downloads', 'mail');
    expect(parseAttachmentDownloadRoots([inside, root].join(path.delimiter))).toEqual([
      inside,
      root,
    ]);
  });
});

describe('decodeAttachmentData', () => {
  it('decodes base64url', () => {
    const bytes = Buffer.from([0xfb, 0xff, 0xfe, 0x00]);
    expect(decodeAttachmentData(bytes.toString('base64url'))).toEqual(bytes);
  });

  it('accepts an empty attachment when Gmail reports size 0', () => {
    expect(decodeAttachmentData('', 0)).toEqual(Buffer.alloc(0));
    expect(decodeAttachmentData(undefined, 0)).toEqual(Buffer.alloc(0));
  });

  it.each([[''], [null], [undefined]])('rejects missing data (%j) of non-zero size', (data) => {
    expect(() => decodeAttachmentData(data, 10)).toThrow(/no data/);
  });

  it.each([['abc+/def'], ['A'], ['AAAAA']])('rejects invalid base64url %j', (data) => {
    expect(() => decodeAttachmentData(data)).toThrow(/not valid base64url/);
  });

  it('rejects data over the size limit before decoding it', () => {
    const tooBig = 'A'.repeat(Math.ceil(((ATTACHMENT_DOWNLOAD_BYTE_LIMIT + 16) * 4) / 3));
    expect(() => decodeAttachmentData(tooBig)).toThrow(/over the .*-byte limit/);
  });
});

describe('downloadMessageAttachment parameters', () => {
  const parse = (args: Record<string, unknown>) => loadTool().parameters.parse(args);

  it('requires savePath', () => {
    expect(() => parse({ messageId: 'm', partId: '1' })).toThrow();
  });

  it('requires partId or attachmentId', () => {
    expect(() => parse({ messageId: 'm', savePath: 'x' })).toThrow(/partId/);
  });

  it('rejects unknown parameters', () => {
    expect(() => parse({ messageId: 'm', partId: '1', savePath: 'x', extra: true })).toThrow();
  });
});

describe('downloadMessageAttachment', () => {
  it('saves to an explicit file path and returns path, size and MIME type', async () => {
    const savePath = path.join(root, 'out', 'invoice.pdf');
    const result = await run({ messageId: 'msg-1', partId: '1', savePath });

    expect(result).toMatchObject({
      savedTo: savePath,
      filename: 'invoice.pdf',
      mimeType: 'application/pdf',
      sizeBytes: PDF.length,
    });
    expect(fs.readFileSync(savePath)).toEqual(PDF);
    expect(attachmentsGet).toHaveBeenCalledWith({
      userId: 'me',
      messageId: 'msg-1',
      id: 'att-pdf',
    });
  });

  it("saves into a directory under the attachment's own name", async () => {
    const result = await run({ messageId: 'msg-1', partId: '1', savePath: root });
    expect(result.savedTo).toBe(path.join(root, 'report.pdf'));
    expect(fs.readFileSync(path.join(root, 'report.pdf'))).toEqual(PDF);
  });

  it('treats a missing path ending in a separator as a directory and creates it', async () => {
    const dir = path.join(root, 'new-dir') + path.sep;
    const result = await run({ messageId: 'msg-1', partId: '1', savePath: dir });
    expect(result.savedTo).toBe(path.join(root, 'new-dir', 'report.pdf'));
  });

  it('saves an empty attachment', async () => {
    mockGmail({ data: '', size: 0 });
    const savePath = path.join(root, 'empty.txt');
    const result = await run({ messageId: 'msg-1', attachmentId: 'att-pdf', savePath });
    expect(result.sizeBytes).toBe(0);
    expect(fs.readFileSync(savePath)).toEqual(Buffer.alloc(0));
  });

  it('leaves no temp file behind', async () => {
    await run({ messageId: 'msg-1', partId: '1', savePath: root });
    expect(fs.readdirSync(root)).toEqual(['report.pdf']);
  });

  describe('choosing the attachment', () => {
    it('downloads the ID Gmail issued for partId, ignoring a mismatched attachmentId', async () => {
      const savePath = path.join(root, 'out.pdf');
      const result = await run({
        messageId: 'msg-1',
        partId: '1',
        attachmentId: 'att-script',
        savePath,
      });
      expect(attachmentsGet.mock.calls[0][0].id).toBe('att-pdf');
      expect(result.mimeType).toBe('application/pdf');
      expect(fs.readFileSync(savePath)).toEqual(PDF);
    });

    it('matches metadata by attachmentId when no partId is given', async () => {
      const result = await run({ messageId: 'msg-1', attachmentId: 'att-script', savePath: root });
      expect(result).toMatchObject({ filename: 'run.sh', mimeType: 'text/x-shellscript' });
      expect(fs.readFileSync(result.savedTo)).toEqual(SCRIPT);
    });

    it('refuses a directory target when a stale attachmentId cannot be matched', async () => {
      await expect(
        run({ messageId: 'msg-1', attachmentId: 'reissued', savePath: root })
      ).rejects.toThrow(/Pass partId/);
      expect(attachmentsGet).not.toHaveBeenCalled();
    });

    it('saves a stale attachmentId to an explicit file path as octet-stream', async () => {
      const savePath = path.join(root, 'file.bin');
      const result = await run({ messageId: 'msg-1', attachmentId: 'reissued', savePath });
      expect(result).toMatchObject({ filename: 'file.bin', mimeType: 'application/octet-stream' });
      expect(attachmentsGet.mock.calls[0][0].id).toBe('reissued');
    });

    it('rejects an unknown partId', async () => {
      await expect(run({ messageId: 'msg-1', partId: '9', savePath: root })).rejects.toThrow(
        /no attachment with partId "9"/
      );
    });

    it('refuses an attachment Gmail reports as over the limit before downloading it', async () => {
      mockGmail({ pdfSize: ATTACHMENT_DOWNLOAD_BYTE_LIMIT + 1 });
      await expect(run({ messageId: 'msg-1', partId: '1', savePath: root })).rejects.toThrow(
        /over the .*-byte limit/
      );
      expect(attachmentsGet).not.toHaveBeenCalled();
    });
  });

  describe('path boundary', () => {
    it('blocks a savePath that escapes the root, without stat-ing it or calling Gmail', async () => {
      const outside = tempDir('gmail-outside-');
      try {
        const error = await run({ messageId: 'msg-1', partId: '1', savePath: outside }).catch(
          (e) => e
        );
        expect(error).toBeInstanceOf(UserError);
        // Same message whatever lies outside: no resolved path, no hint it is a directory.
        expect(error.message).toBe(
          'savePath must stay inside the allowed download directory ' +
            '(GOOGLE_DOCS_MCP_DOWNLOAD_ROOTS).'
        );
        expect(getGmailClient).not.toHaveBeenCalled();
        expect(fs.readdirSync(outside)).toEqual([]);
      } finally {
        fs.rmSync(outside, { recursive: true, force: true });
      }
    });

    it('blocks ../ traversal', async () => {
      const savePath = path.join(root, '..', 'escaped.pdf');
      await expect(run({ messageId: 'msg-1', partId: '1', savePath })).rejects.toThrow(
        /must stay inside/
      );
      expect(fs.existsSync(savePath)).toBe(false);
    });

    it('keeps a hostile attachment file name inside the target directory', async () => {
      mockGmail({ filename: '../../../escaped.pdf' });
      const result = await run({ messageId: 'msg-1', partId: '1', savePath: root });
      expect(path.dirname(result.savedTo)).toBe(root);
      expect(path.basename(result.savedTo)).toBe('___.._.._escaped.pdf');
    });

    it('blocks a symlinked directory that points out of the root', async () => {
      const outside = tempDir('gmail-outside-');
      try {
        fs.symlinkSync(outside, path.join(root, 'link'));
        await expect(
          run({ messageId: 'msg-1', partId: '1', savePath: path.join(root, 'link') })
        ).rejects.toThrow(/must stay inside/);
        expect(fs.readdirSync(outside)).toEqual([]);
      } finally {
        fs.rmSync(outside, { recursive: true, force: true });
      }
    });

    it.each([
      ['.git/hooks/pre-commit'],
      ['.GIT/hooks/pre-commit'],
      ['.npmrc'],
      ['sub/.vscode/settings.json'],
      ['‌.git/hooks/pre-commit'],
      ['sub​/report.pdf'],
    ])('refuses an unsafe segment in savePath (%j), even with overwrite', async (relative) => {
      const savePath = path.join(root, relative);
      await expect(
        run({ messageId: 'msg-1', partId: '1', savePath, overwrite: true })
      ).rejects.toThrow(/may not use/);
      expect(fs.existsSync(savePath)).toBe(false);
      expect(getGmailClient).not.toHaveBeenCalled();
    });

    it('refuses a symlink inside the root that points at a hidden folder', async () => {
      fs.mkdirSync(path.join(root, '.git', 'hooks'), { recursive: true });
      fs.symlinkSync(path.join(root, '.git'), path.join(root, 'docs'));
      await expect(
        run({
          messageId: 'msg-1',
          partId: '1',
          savePath: path.join(root, 'docs', 'hooks', 'pre-commit'),
        })
      ).rejects.toThrow(/may not use "\.git"/);
      expect(fs.readdirSync(path.join(root, '.git', 'hooks'))).toEqual([]);
    });

    it('allows a download root that itself sits inside a hidden folder', async () => {
      const hiddenRoot = path.join(root, '.cache', 'downloads');
      fs.mkdirSync(hiddenRoot, { recursive: true });
      process.env.GOOGLE_DOCS_MCP_DOWNLOAD_ROOTS = hiddenRoot;
      const result = await run({ messageId: 'msg-1', partId: '1', savePath: hiddenRoot });
      expect(result.savedTo).toBe(path.join(hiddenRoot, 'report.pdf'));
    });

    it.each([['outer-first'], ['inner-first']])(
      'gives the same answer for nested roots whatever their order (%s)',
      async (order) => {
        const inner = path.join(root, '.cache', 'downloads');
        fs.mkdirSync(inner, { recursive: true });
        const roots = order === 'outer-first' ? [root, inner] : [inner, root];
        process.env.GOOGLE_DOCS_MCP_DOWNLOAD_ROOTS = roots.join(path.delimiter);
        const result = await run({ messageId: 'msg-1', partId: '1', savePath: inner });
        expect(result.savedTo).toBe(path.join(inner, 'report.pdf'));
      }
    );

    it('refuses every download while the env var is unset, without calling Gmail', async () => {
      delete process.env.GOOGLE_DOCS_MCP_DOWNLOAD_ROOTS;
      const cwdTarget = path.join(process.cwd(), `unset-roots-${process.pid}.pdf`);
      try {
        await expect(run({ messageId: 'msg-1', partId: '1', savePath: cwdTarget })).rejects.toThrow(
          /GOOGLE_DOCS_MCP_DOWNLOAD_ROOTS is not set/
        );
        expect(getGmailClient).not.toHaveBeenCalled();
        expect(fs.existsSync(cwdTarget)).toBe(false);
      } finally {
        fs.rmSync(cwdTarget, { force: true });
      }
    });
  });

  describe('existing files', () => {
    it('refuses to overwrite an existing file by default', async () => {
      const savePath = path.join(root, 'report.pdf');
      fs.writeFileSync(savePath, 'original');
      await expect(run({ messageId: 'msg-1', partId: '1', savePath })).rejects.toThrow(
        /already exists/
      );
      expect(fs.readFileSync(savePath, 'utf8')).toBe('original');
      expect(getGmailClient).not.toHaveBeenCalled();
    });

    it('refuses an existing file in a directory target before downloading', async () => {
      fs.writeFileSync(path.join(root, 'report.pdf'), 'original');
      await expect(run({ messageId: 'msg-1', partId: '1', savePath: root })).rejects.toThrow(
        /already exists/
      );
      expect(attachmentsGet).not.toHaveBeenCalled();
    });

    it('overwrites with a fresh file: no exec bit kept, other hard links untouched', async () => {
      const savePath = path.join(root, 'deploy.sh');
      const otherLink = path.join(root, 'other-name.sh');
      fs.writeFileSync(savePath, 'original', { mode: 0o755 });
      fs.chmodSync(savePath, 0o755);
      fs.linkSync(savePath, otherLink);

      await run({ messageId: 'msg-1', partId: '1', savePath, overwrite: true });

      expect(fs.readFileSync(savePath)).toEqual(PDF);
      expect(fs.statSync(savePath).mode & 0o111).toBe(0);
      expect(fs.readFileSync(otherLink, 'utf8')).toBe('original');
    });

    it('refuses a dangling symlink at the target, even with overwrite', async () => {
      const outside = tempDir('gmail-outside-');
      try {
        const savePath = path.join(root, 'report.pdf');
        fs.symlinkSync(path.join(outside, 'planted.pdf'), savePath);
        await expect(
          run({ messageId: 'msg-1', partId: '1', savePath, overwrite: true })
        ).rejects.toThrow(/symbolic link/);
        expect(fs.readdirSync(outside)).toEqual([]);
      } finally {
        fs.rmSync(outside, { recursive: true, force: true });
      }
    });

    it('refuses a directory at the target', async () => {
      fs.mkdirSync(path.join(root, 'report.pdf'));
      await expect(
        run({ messageId: 'msg-1', partId: '1', savePath: root, overwrite: true })
      ).rejects.toThrow(/is a directory/);
    });
  });

  describe('changes on disk while the attachment downloads', () => {
    const savePath = () => path.join(root, 'report.pdf');

    function duringDownload(change: () => void) {
      const original = attachmentsGet.getMockImplementation()!;
      attachmentsGet.mockImplementationOnce(async (args: any) => {
        change();
        return original(args);
      });
    }

    it('does not replace a file that appeared meanwhile', async () => {
      duringDownload(() => fs.writeFileSync(savePath(), 'appeared'));
      await expect(run({ messageId: 'msg-1', partId: '1', savePath: savePath() })).rejects.toThrow(
        /already exists/
      );
      expect(fs.readFileSync(savePath(), 'utf8')).toBe('appeared');
    });

    it('does not follow a symlink that appeared meanwhile', async () => {
      const outside = tempDir('gmail-outside-');
      try {
        duringDownload(() => fs.symlinkSync(path.join(outside, 'x.pdf'), savePath()));
        await expect(
          run({ messageId: 'msg-1', partId: '1', savePath: savePath(), overwrite: true })
        ).rejects.toThrow(/symbolic link/);
        expect(fs.readdirSync(outside)).toEqual([]);
      } finally {
        fs.rmSync(outside, { recursive: true, force: true });
      }
    });

    it('does not write into a directory that appeared meanwhile', async () => {
      duringDownload(() => fs.mkdirSync(savePath()));
      await expect(
        run({ messageId: 'msg-1', partId: '1', savePath: savePath(), overwrite: true })
      ).rejects.toThrow(/is a directory/);
    });

    it('creates no folders outside the root when an ancestor is swapped for a symlink', async () => {
      const outside = tempDir('gmail-outside-');
      const sub = path.join(root, 'sub');
      fs.mkdirSync(sub);
      try {
        duringDownload(() => {
          fs.rmSync(sub, { recursive: true });
          fs.symlinkSync(outside, sub);
        });
        await expect(
          run({ messageId: 'msg-1', partId: '1', savePath: path.join(sub, 'a', 'b', 'x.pdf') })
        ).rejects.toThrow(/must stay inside/);
        expect(fs.readdirSync(outside)).toEqual([]);
      } finally {
        fs.rmSync(outside, { recursive: true, force: true });
      }
    });

    it('does not write outside the root when the parent is swapped for a symlink', async () => {
      const outside = tempDir('gmail-outside-');
      const parent = path.join(root, 'inbox');
      fs.mkdirSync(parent);
      try {
        duringDownload(() => {
          fs.rmSync(parent, { recursive: true });
          fs.symlinkSync(outside, parent);
        });
        await expect(
          run({ messageId: 'msg-1', partId: '1', savePath: path.join(parent, 'report.pdf') })
        ).rejects.toThrow(/must stay inside/);
        expect(fs.readdirSync(outside)).toEqual([]);
      } finally {
        fs.rmSync(outside, { recursive: true, force: true });
      }
    });
  });

  describe('bad data and errors', () => {
    it('writes nothing when the attachment data is invalid', async () => {
      mockGmail({ data: 'not base64!' });
      const savePath = path.join(root, 'bad.pdf');
      await expect(run({ messageId: 'msg-1', partId: '1', savePath })).rejects.toThrow(
        /not valid base64url/
      );
      expect(fs.readdirSync(root)).toEqual([]);
    });

    it('keeps the old file intact when an overwrite fails', async () => {
      mockGmail({ data: 'not base64!' });
      const savePath = path.join(root, 'report.pdf');
      fs.writeFileSync(savePath, 'original');
      await expect(
        run({ messageId: 'msg-1', partId: '1', savePath, overwrite: true })
      ).rejects.toThrow(/not valid base64url/);
      expect(fs.readFileSync(savePath, 'utf8')).toBe('original');
    });

    it('writes nothing when Gmail returns no data', async () => {
      mockGmail({ data: null });
      await expect(
        run({ messageId: 'msg-1', partId: '1', savePath: path.join(root, 'empty.pdf') })
      ).rejects.toThrow(/no data/);
      expect(fs.readdirSync(root)).toEqual([]);
    });

    it.runIf(process.platform !== 'win32' && process.getuid?.() !== 0)(
      'reports a filesystem error by code only, without paths',
      async () => {
        const locked = path.join(root, 'locked');
        fs.mkdirSync(locked, { mode: 0o500 });
        try {
          const error = await run({
            messageId: 'msg-1',
            partId: '1',
            savePath: path.join(locked, 'report.pdf'),
          }).catch((e) => e);
          expect(error).toBeInstanceOf(UserError);
          expect(error.message).toBe('Could not save the attachment (EACCES).');
        } finally {
          fs.chmodSync(locked, 0o700);
        }
      }
    );

    it('wraps a 404 from Gmail', async () => {
      messagesGet.mockRejectedValueOnce(Object.assign(new Error('Not Found'), { code: 404 }));
      const error = await run({ messageId: 'gone', partId: '1', savePath: root }).catch((e) => e);
      expect(error).toBeInstanceOf(UserError);
      expect(error.message).toMatch(/not found \(message ID: gone\)/);
    });

    it('wraps a 403 from Gmail', async () => {
      attachmentsGet.mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { code: 403 }));
      await expect(run({ messageId: 'msg-1', partId: '1', savePath: root })).rejects.toThrow(
        /Permission denied/
      );
    });

    it('wraps other API errors', async () => {
      attachmentsGet.mockRejectedValueOnce(new Error('Backend Error'));
      const error = await run({ messageId: 'msg-1', partId: '1', savePath: root }).catch((e) => e);
      expect(error).toBeInstanceOf(UserError);
      expect(error.message).toBe('Failed to download Gmail attachment: Backend Error');
    });

    it('is unavailable in httpStream mode', async () => {
      process.env.MCP_TRANSPORT = 'httpStream';
      await expect(run({ messageId: 'msg-1', partId: '1', savePath: root })).rejects.toThrow(
        /not available when the server runs in httpStream mode/
      );
      expect(getGmailClient).not.toHaveBeenCalled();
    });
  });

  describe('filesystems without hard links', () => {
    const noLinks = () =>
      vi
        .spyOn(fsp, 'link')
        .mockRejectedValue(Object.assign(new Error('not permitted'), { code: 'EPERM' }));

    it('saves with an exclusive create instead', async () => {
      const link = noLinks();
      try {
        const result = await run({ messageId: 'msg-1', partId: '1', savePath: root });
        expect(fs.readFileSync(result.savedTo)).toEqual(PDF);
        expect(fs.readdirSync(root)).toEqual(['report.pdf']);
      } finally {
        link.mockRestore();
      }
    });

    it('removes the partial file when that write fails', async () => {
      const link = noLinks();
      const realOpen = fsp.open.bind(fsp);
      let opens = 0;
      const open = vi.spyOn(fsp, 'open').mockImplementation(async (...args: any[]) => {
        const handle = await (realOpen as any)(...args);
        if (++opens === 2) {
          // The fallback's handle: write a little, then run out of space.
          const write = handle.writeFile.bind(handle);
          handle.writeFile = async (data: Buffer) => {
            await write(data.subarray(0, 10));
            throw Object.assign(new Error('no space left'), { code: 'ENOSPC' });
          };
        }
        return handle;
      });
      try {
        const error = await run({ messageId: 'msg-1', partId: '1', savePath: root }).catch(
          (e) => e
        );
        expect(error.message).toBe('Could not save the attachment (ENOSPC).');
        expect(opens).toBe(2);
        expect(fs.readdirSync(root)).toEqual([]);
      } finally {
        open.mockRestore();
        link.mockRestore();
      }
    });
  });

  describe('marking the file as downloaded', () => {
    it.runIf(process.platform === 'darwin')('sets com.apple.quarantine on macOS', async () => {
      const result = await run({ messageId: 'msg-1', partId: '1', savePath: root });
      expect(result.markedAsDownloaded).toBe(true);
      const value = execFileSync('/usr/bin/xattr', ['-p', 'com.apple.quarantine', result.savedTo])
        .toString()
        .trim();
      expect(value).toMatch(/^0081;[0-9a-f]+;google-docs-mcp;$/);
    });

    it.runIf(process.platform === 'darwin')('tags a symlink itself, not its target', async () => {
      const file = path.join(root, 'real.txt');
      const link = path.join(root, 'link.txt');
      fs.writeFileSync(file, 'x');
      fs.symlinkSync(file, link);
      expect(await markAsDownloaded(link)).toBe(true);
      expect(() =>
        execFileSync('/usr/bin/xattr', ['-p', 'com.apple.quarantine', file], { stdio: 'pipe' })
      ).toThrow();
    });

    it('never fails the download when tagging fails', async () => {
      expect(await markAsDownloaded(path.join(root, 'missing.pdf'))).toBe(false);
      expect(await markAsDownloaded(path.join(root, 'x'), 'linux')).toBe(false);
    });
  });
});

import type { FastMCP } from 'fastmcp';
import { UserError, imageContent } from 'fastmcp';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { getDriveClient } from '../../clients.js';
import { requestClients } from '../../remoteWrapper.js';
import { createDownloadToken } from '../../downloadProxy.js';
import { ensureWithinDownloadRoots, parseDownloadRoots } from './savePathGuard.js';

const isRemote = process.env.MCP_TRANSPORT === 'httpStream';

export const WORKSPACE_EXPORT_DEFAULTS: Record<string, string> = {
  'application/vnd.google-apps.document': 'text/markdown',
  'application/vnd.google-apps.spreadsheet': 'text/csv',
  'application/vnd.google-apps.presentation': 'text/plain',
  'application/vnd.google-apps.drawing': 'image/png',
  'application/vnd.google-apps.script': 'application/vnd.google-apps.script+json',
};

export const EXPORT_MIME_TO_EXTENSION: Record<string, string> = {
  'text/markdown': '.md',
  'text/plain': '.txt',
  'text/csv': '.csv',
  'text/tab-separated-values': '.tsv',
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'application/vnd.google-apps.script+json': '.json',
};

const MAX_TEXT_EXTRACT_BYTES = 50_000;

export function isTextMimeType(mime: string): boolean {
  return (
    mime.startsWith('text/') ||
    mime === 'application/json' ||
    mime === 'application/vnd.google-apps.script+json'
  );
}

function isWorkspaceMimeType(mime: string): boolean {
  return mime.startsWith('application/vnd.google-apps.');
}

const DownloadFileParameters = z.strictObject({
  fileId: z.string().describe('The file ID from a Google Drive URL or previous tool result.'),
  savePath: z
    .string()
    .optional()
    .describe(
      'Local file path to save the downloaded file to. Parent directories are created automatically. ' +
        "If omitted, saves to the current working directory using the file's original name " +
        '(with an appropriate extension for exported Google Workspace files).'
    ),
  exportMimeType: z
    .string()
    .optional()
    .describe(
      'For Google Workspace files only: the MIME type to export as. ' +
        'E.g. "text/markdown", "application/pdf", "text/csv". ' +
        'Defaults: Docs->text/markdown, Sheets->text/csv, Slides->text/plain, Drawings->image/png.'
    ),
  extractText: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      'If true, return text content in the response (up to 50KB) alongside saving the file. ' +
        'Works for text/*, application/json. For binary files, only the save path is returned.'
    ),
  returnAs: z
    .enum(['url', 'content'])
    .optional()
    .default('url')
    .describe(
      'Remote mode only. ' +
        '"url" (default): returns a short-lived download URL -- use curl -o to save to disk. ' +
        '"content": returns file content inline (text, image, or base64 resource).'
    ),
});

export function register(server: FastMCP) {
  server.addTool({
    name: 'downloadFile',
    description:
      'Downloads any file from Google Drive to a local path. ' +
      'For Google Workspace files (Docs, Sheets, Slides), exports to a specified format ' +
      '(defaults to text/markdown for Docs, text/csv for Sheets). ' +
      'For regular files (PDFs, images, etc.), downloads the raw bytes. ' +
      'Optionally extracts and returns text content for text-based files.',
    parameters: DownloadFileParameters,
    execute: async (args, { log }) => {
      const drive = await getDriveClient();
      log.info(`Downloading file ${args.fileId}${args.savePath ? ` to ${args.savePath}` : ''}`);

      let resolvedSavePath: string | undefined;
      try {
        // 1. Get file metadata
        const metadataRes = await drive.files.get({
          fileId: args.fileId,
          fields: 'name,mimeType,size',
          supportsAllDrives: true,
        });

        const fileName = path.basename(metadataRes.data.name || 'download');
        const originalMimeType = metadataRes.data.mimeType || 'application/octet-stream';
        const isWorkspace = isWorkspaceMimeType(originalMimeType);

        // 2. Resolve export MIME type for Workspace files
        let exportMime: string | undefined;
        if (isWorkspace) {
          exportMime = args.exportMimeType || WORKSPACE_EXPORT_DEFAULTS[originalMimeType];
          if (!exportMime) {
            const shortType = originalMimeType.replace('application/vnd.google-apps.', '');
            throw new UserError(
              `Unsupported Google Workspace type "${shortType}". ` +
                `Provide an exportMimeType parameter to specify the desired export format.`
            );
          }
        }

        // ---------- Remote mode ----------
        if (isRemote) {
          const resolvedFileName =
            isWorkspace && exportMime
              ? path.parse(fileName).name + (EXPORT_MIME_TO_EXTENSION[exportMime] || '')
              : fileName;
          const outputMime = exportMime || originalMimeType;

          // --- returnAs: "url" (default) -- agent uses curl to save to disk ---
          if (args.returnAs !== 'content') {
            const store = requestClients.getStore();
            if (!store) throw new UserError('Request context missing.');

            const token = createDownloadToken({
              fileId: args.fileId,
              accessToken: store.accessToken,
              exportMime,
              fileName: resolvedFileName,
              mimeType: outputMime,
              isWorkspace,
            });

            const result: Record<string, unknown> = {
              downloadUrl: `${process.env.BASE_URL}/download/${token}`,
              fileName: resolvedFileName,
              originalMimeType,
            };
            if (isWorkspace && exportMime) result.exportedAs = exportMime;

            if (args.extractText !== false && isTextMimeType(outputMime)) {
              try {
                const textRes =
                  isWorkspace && exportMime
                    ? await drive.files.export(
                        { fileId: args.fileId, mimeType: exportMime },
                        { responseType: 'text' }
                      )
                    : await drive.files.get(
                        { fileId: args.fileId, alt: 'media', supportsAllDrives: true },
                        { responseType: 'text' }
                      );
                result.textContent = (textRes.data as string).slice(0, MAX_TEXT_EXTRACT_BYTES);
              } catch {
                log.warn?.('Could not extract text content');
              }
            }

            return JSON.stringify(result, null, 2);
          }

          // --- returnAs: "content" -- inline via MCP content types ---
          let fileBuffer: Buffer;
          if (isWorkspace && exportMime) {
            log.info(`Exporting Workspace file as ${exportMime}`);
            const res = await drive.files.export(
              { fileId: args.fileId, mimeType: exportMime },
              { responseType: 'arraybuffer' }
            );
            fileBuffer = Buffer.from(res.data as ArrayBuffer);
          } else {
            log.info('Downloading blob file into memory');
            const res = await drive.files.get(
              { fileId: args.fileId, alt: 'media', supportsAllDrives: true },
              { responseType: 'arraybuffer' }
            );
            fileBuffer = Buffer.from(res.data as ArrayBuffer);
          }

          const MAX_INLINE_BYTES = 100 * 1024 * 1024;
          const content: any[] = [];

          if (isTextMimeType(outputMime)) {
            content.push({
              type: 'text' as const,
              text: fileBuffer.toString('utf-8').slice(0, MAX_TEXT_EXTRACT_BYTES),
            });
          } else if (outputMime.startsWith('image/') && fileBuffer.length <= MAX_INLINE_BYTES) {
            content.push(await imageContent({ buffer: fileBuffer }));
          } else if (fileBuffer.length <= MAX_INLINE_BYTES) {
            content.push({
              type: 'resource' as const,
              resource: {
                uri: `gdrive:///${args.fileId}/${resolvedFileName}`,
                blob: fileBuffer.toString('base64'),
                mimeType: outputMime,
              },
            });
          } else {
            throw new UserError(
              `File too large for inline transfer (${(fileBuffer.length / 1024 / 1024).toFixed(1)}MB, limit 100MB).`
            );
          }

          content.push({
            type: 'text' as const,
            text: JSON.stringify({
              fileName: resolvedFileName,
              originalMimeType,
              sizeBytes: fileBuffer.length,
            }),
          });

          return { content };
        }

        // ---------- Stdio mode: write to local disk ----------
        resolvedSavePath = args.savePath;
        if (resolvedSavePath) resolvedSavePath = path.resolve(resolvedSavePath);

        if (!resolvedSavePath) {
          if (isWorkspace && exportMime) {
            const baseName = path.parse(fileName).name;
            const ext = EXPORT_MIME_TO_EXTENSION[exportMime] || '';
            resolvedSavePath = path.join(process.cwd(), baseName + ext);
          } else {
            resolvedSavePath = path.join(process.cwd(), fileName);
          }
        }
        resolvedSavePath = path.resolve(resolvedSavePath);

        // `savePath` is agent-controlled and reaches the filesystem directly, so
        // confine it before creating directories or opening a write stream.
        try {
          resolvedSavePath = ensureWithinDownloadRoots(resolvedSavePath, parseDownloadRoots());
        } catch (boundaryError: any) {
          throw new UserError(boundaryError?.message || String(boundaryError));
        }

        fs.mkdirSync(path.dirname(resolvedSavePath), { recursive: true });

        let outputMime: string;
        if (isWorkspace && exportMime) {
          log.info(`Exporting Workspace file as ${exportMime}`);
          const res = await drive.files.export(
            { fileId: args.fileId, mimeType: exportMime },
            { responseType: 'stream' }
          );
          await pipeline(res.data as any, fs.createWriteStream(resolvedSavePath));
          outputMime = exportMime;
        } else {
          log.info(`Downloading blob file`);
          const res = await drive.files.get(
            { fileId: args.fileId, alt: 'media', supportsAllDrives: true },
            { responseType: 'stream' }
          );
          await pipeline(res.data as any, fs.createWriteStream(resolvedSavePath));
          outputMime = originalMimeType;
        }

        const sizeBytes = fs.statSync(resolvedSavePath).size;

        let textContent: string | undefined;
        if (args.extractText !== false && isTextMimeType(outputMime)) {
          try {
            const raw = fs.readFileSync(resolvedSavePath, 'utf-8');
            textContent = raw.slice(0, MAX_TEXT_EXTRACT_BYTES);
          } catch {
            log.warn?.(`Could not read text from ${resolvedSavePath}`);
          }
        }

        const result: Record<string, unknown> = {
          savedTo: resolvedSavePath,
          fileName,
          originalMimeType,
          sizeBytes,
        };
        if (isWorkspace && exportMime) result.exportedAs = exportMime;
        if (textContent !== undefined) result.textContent = textContent;

        return JSON.stringify(result, null, 2);
      } catch (error: any) {
        if (!isRemote && resolvedSavePath) {
          try {
            fs.unlinkSync(resolvedSavePath);
          } catch {
            /* file may not exist yet */
          }
        }
        log.error(`Error downloading file ${args.fileId}: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        if (error.code === 404)
          throw new UserError(`File not found (ID: ${args.fileId}). Check the file ID.`);
        if (error.code === 403)
          throw new UserError(
            `Permission denied for file ${args.fileId}. Ensure the authenticated user has access.`
          );
        throw new UserError(`Failed to download file: ${error.message || 'Unknown error'}`);
      }
    },
  });
}

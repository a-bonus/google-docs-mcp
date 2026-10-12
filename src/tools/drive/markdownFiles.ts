import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { Readable } from 'node:stream';
import { getDriveClient } from '../../clients.js';

export const MARKDOWN_MIME = 'text/markdown';

const EDITABLE_TEXT_MIMES = new Set(['text/markdown', 'text/x-markdown', 'text/plain']);

/** Ensures a Drive file name ends in .md (or .markdown). */
export function ensureMarkdownFileName(name: string): string {
  const trimmed = name.trim();
  if (/\.md$/i.test(trimmed) || /\.markdown$/i.test(trimmed)) return trimmed;
  return `${trimmed}.md`;
}

/** True when a Drive MIME type holds raw editable text (not a Google Workspace doc). */
export function isEditableMarkdownMime(mime: string): boolean {
  if (EDITABLE_TEXT_MIMES.has(mime)) return true;
  return mime.startsWith('text/');
}

/** Truncates content to maxLength, reporting whether it was cut. */
export function truncateContent(
  content: string,
  maxLength: number
): { content: string; truncated: boolean } {
  if (content.length <= maxLength) return { content, truncated: false };
  return { content: content.slice(0, maxLength), truncated: true };
}

function toStream(content: string): Readable {
  return Readable.from([content]);
}

export function register(server: FastMCP) {
  server.addTool({
    name: 'createMarkdownFile',
    description:
      'Creates a native Markdown (.md) file in Google Drive. Unlike createDocument (which makes a Google Doc and converts markdown to formatted content), this keeps the raw .md source so Docs/Drive edit it natively with live preview and comments preserved.',
    parameters: z.strictObject({
      title: z
        .string()
        .min(1)
        .describe('Title for the new file. The .md extension is added if missing.'),
      parentFolderId: z
        .string()
        .optional()
        .describe(
          'ID of folder where the file should be created. If not provided, creates in Drive root.'
        ),
      content: z
        .string()
        .optional()
        .describe('Raw markdown source to store. If omitted, creates an empty .md file.'),
    }),
    execute: async (args, { log }) => {
      const drive = await getDriveClient();
      log.info(`Creating native markdown file "${args.title}"`);
      try {
        const metadata: any = {
          name: ensureMarkdownFileName(args.title),
          mimeType: MARKDOWN_MIME,
        };
        if (args.parentFolderId) metadata.parents = [args.parentFolderId];
        const response = await drive.files.create({
          requestBody: metadata,
          ...(args.content !== undefined
            ? { media: { mimeType: MARKDOWN_MIME, body: toStream(args.content) } }
            : {}),
          fields: 'id,name,mimeType,webViewLink',
          supportsAllDrives: true,
        });
        const file = response.data;
        return JSON.stringify(
          { id: file.id, name: file.name, mimeType: file.mimeType, url: file.webViewLink },
          null,
          2
        );
      } catch (error: any) {
        log.error(`Error creating markdown file: ${error.message || error}`);
        if (error.code === 404)
          throw new UserError('Parent folder not found. Check the folder ID.');
        if (error.code === 403)
          throw new UserError(
            'Permission denied. Make sure you have write access to the destination folder.'
          );
        throw new UserError(`Failed to create markdown file: ${error.message || 'Unknown error'}`);
      }
    },
  });

  server.addTool({
    name: 'readMarkdownFile',
    description:
      'Reads the raw markdown source of a native .md file in Drive (mimeType text/markdown). For Google Docs documents, use readDocument instead.',
    parameters: z.strictObject({
      fileId: z.string().describe('The Drive file ID of the .md file.'),
      maxLength: z
        .number()
        .int()
        .positive()
        .optional()
        .default(100_000)
        .describe('Maximum characters to return. Longer files are truncated.'),
    }),
    execute: async (args, { log }) => {
      const drive = await getDriveClient();
      log.info(`Reading markdown file ${args.fileId}`);
      try {
        const meta = await drive.files.get({
          fileId: args.fileId,
          fields: 'id,name,mimeType,size',
          supportsAllDrives: true,
        });
        const mimeType = meta.data.mimeType || 'application/octet-stream';
        if (mimeType.startsWith('application/vnd.google-apps.')) {
          throw new UserError(
            `File is a Google Workspace document (${mimeType}), not a native .md file. Use readDocument with this ID instead.`
          );
        }
        if (!isEditableMarkdownMime(mimeType)) {
          throw new UserError(
            `File MIME type ${mimeType} is not editable text. readMarkdownFile supports text files such as text/markdown.`
          );
        }
        const res = await drive.files.get(
          { fileId: args.fileId, alt: 'media', supportsAllDrives: true },
          { responseType: 'text' }
        );
        const raw = typeof res.data === 'string' ? res.data : String(res.data ?? '');
        const { content, truncated } = truncateContent(raw, args.maxLength);
        return JSON.stringify(
          {
            id: meta.data.id,
            name: meta.data.name,
            mimeType,
            size: meta.data.size,
            truncated,
            content,
          },
          null,
          2
        );
      } catch (error: any) {
        if (error instanceof UserError) throw error;
        log.error(`Error reading markdown file: ${error.message || error}`);
        if (error.code === 404) throw new UserError('File not found. Check the file ID.');
        throw new UserError(`Failed to read markdown file: ${error.message || 'Unknown error'}`);
      }
    },
  });

  server.addTool({
    name: 'updateMarkdownFile',
    description:
      'Replaces (or appends to) the raw markdown source of a native .md file in Drive. Edits apply as file content, not as Docs suggestions: use listSuggestions/manageSuggestions only for Google Docs.',
    parameters: z.strictObject({
      fileId: z.string().describe('The Drive file ID of the .md file.'),
      content: z
        .string()
        .describe(
          'Markdown source to write. With append=true it is added after the current content.'
        ),
      append: z
        .boolean()
        .optional()
        .default(false)
        .describe('When true, appends content to the file instead of replacing it.'),
    }),
    execute: async (args, { log }) => {
      const drive = await getDriveClient();
      log.info(`Updating markdown file ${args.fileId}${args.append ? ' (append)' : ''}`);
      try {
        const meta = await drive.files.get({
          fileId: args.fileId,
          fields: 'id,name,mimeType',
          supportsAllDrives: true,
        });
        const mimeType = meta.data.mimeType || 'application/octet-stream';
        if (mimeType.startsWith('application/vnd.google-apps.')) {
          throw new UserError(
            `File is a Google Workspace document (${mimeType}). Edit it with the Docs tools (modifyText, replaceRangeWithMarkdown) instead.`
          );
        }
        if (!isEditableMarkdownMime(mimeType)) {
          throw new UserError(`File MIME type ${mimeType} is not editable text.`);
        }
        let next = args.content;
        if (args.append) {
          const current = await drive.files.get(
            { fileId: args.fileId, alt: 'media', supportsAllDrives: true },
            { responseType: 'text' }
          );
          const prev = typeof current.data === 'string' ? current.data : String(current.data ?? '');
          next = prev + args.content;
        }
        const updated = await drive.files.update({
          fileId: args.fileId,
          media: { mimeType: MARKDOWN_MIME, body: toStream(next) },
          fields: 'id,name,mimeType,webViewLink,modifiedTime',
          supportsAllDrives: true,
        });
        return JSON.stringify(
          {
            id: updated.data.id,
            name: updated.data.name,
            mimeType: updated.data.mimeType,
            url: updated.data.webViewLink,
            modifiedTime: (updated.data as any).modifiedTime,
          },
          null,
          2
        );
      } catch (error: any) {
        if (error instanceof UserError) throw error;
        log.error(`Error updating markdown file: ${error.message || error}`);
        if (error.code === 404) throw new UserError('File not found. Check the file ID.');
        throw new UserError(`Failed to update markdown file: ${error.message || 'Unknown error'}`);
      }
    },
  });
}

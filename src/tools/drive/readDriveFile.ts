import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { getDriveClient } from '../../clients.js';
import * as pdfParse from 'pdf-parse';

export function register(server: FastMCP) {
  server.addTool({
    name: 'readDriveFile',
    description:
      'Reads the text content of a file from Google Drive. Supports PDFs and plain text files. For native Google Docs, use readDocument instead.',
    parameters: z.object({
      fileId: z.string().describe('ID of the Google Drive file to read.'),
    }),
    execute: async (args, { log }) => {
      const drive = await getDriveClient();
      log.info(`Reading Drive file: ${args.fileId}`);

      // Get file metadata first
      let meta: any;
      try {
        const metaRes = await drive.files.get({
          fileId: args.fileId,
          fields: 'id,name,mimeType',
          supportsAllDrives: true,
        });
        meta = metaRes.data;
      } catch (error: any) {
        if (error.code === 404) throw new UserError('File not found. Check the file ID.');
        if (error.code === 403) throw new UserError('Permission denied. Make sure you have access to this file.');
        throw new UserError(`Failed to get file metadata: ${error.message || 'Unknown error'}`);
      }

      log.info(`File: ${meta.name} (${meta.mimeType})`);

      try {
        // Download the raw file content
        const response = await drive.files.get(
          { fileId: args.fileId, alt: 'media', supportsAllDrives: true },
          { responseType: 'arraybuffer' }
        );

        const buffer = Buffer.from(response.data as ArrayBuffer);

        if (meta.mimeType === 'application/pdf') {
          const pdf = (pdfParse as any).default ?? pdfParse;
          const parsed = await pdf(buffer);
          return JSON.stringify({
            name: meta.name,
            mimeType: meta.mimeType,
            pages: parsed.numpages,
            text: parsed.text,
          });
        } else {
          // Plain text / other text formats
          return JSON.stringify({
            name: meta.name,
            mimeType: meta.mimeType,
            text: buffer.toString('utf-8'),
          });
        }
      } catch (error: any) {
        log.error(`Error reading file: ${error.message || error}`);
        throw new UserError(`Failed to read file: ${error.message || 'Unknown error'}`);
      }
    },
  });
}

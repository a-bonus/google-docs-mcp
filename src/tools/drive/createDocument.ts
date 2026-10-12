import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { Readable } from 'node:stream';
import { drive_v3 } from 'googleapis';
import { getDriveClient, getDocsClient } from '../../clients.js';
import { insertMarkdown, formatInsertResult } from '../../markdown-transformer/index.js';

export function register(server: FastMCP) {
  server.addTool({
    name: 'createDocument',
    description:
      'Creates a new Google Document, or a native Markdown (.md) file when fileType is markdown. Optionally places it in a specific folder and adds initial text content.',
    parameters: z.strictObject({
      title: z.string().min(1).describe('Title for the new document.'),
      parentFolderId: z
        .string()
        .optional()
        .describe(
          'ID of folder where document should be created. If not provided, creates in Drive root.'
        ),
      initialContent: z
        .string()
        .optional()
        .describe(
          'Initial content to add to the document. By default, markdown syntax is converted to formatted Google Docs content (headings, bold, italic, links, lists, etc.).'
        ),
      contentFormat: z
        .enum(['markdown', 'raw'])
        .optional()
        .default('markdown')
        .describe(
          "How to interpret initialContent for Google Docs. 'markdown' (default) converts markdown to formatted Google Docs content. 'raw' inserts the text as-is without any conversion. Ignored for native markdown files, which always store raw source."
        ),
      fileType: z
        .enum(['gdoc', 'markdown'])
        .optional()
        .default('gdoc')
        .describe(
          "'gdoc' (default) creates a Google Document and converts markdown to formatted content. 'markdown' creates a native .md Drive file (text/markdown) with the raw source, editable natively in Docs/Drive."
        ),
    }),
    execute: async (args, { log }) => {
      const drive = await getDriveClient();
      log.info(`Creating new document "${args.title}"`);

      try {
        if (args.fileType === 'markdown') {
          const title = args.title.trim();
          const name = /\.md$/i.test(title) || /\.markdown$/i.test(title) ? title : `${title}.md`;
          const metadata: drive_v3.Schema$File = {
            name,
            mimeType: 'text/markdown',
          };
          if (args.parentFolderId) metadata.parents = [args.parentFolderId];
          const created = await drive.files.create({
            requestBody: metadata,
            ...(args.initialContent !== undefined
              ? {
                  media: {
                    mimeType: 'text/markdown',
                    body: Readable.from([args.initialContent]),
                  },
                }
              : {}),
            fields: 'id,name,mimeType,webViewLink',
            supportsAllDrives: true,
          });
          return JSON.stringify(
            {
              id: created.data.id,
              name: created.data.name,
              mimeType: created.data.mimeType,
              url: created.data.webViewLink,
              contentInserted: args.initialContent !== undefined,
              fileType: 'markdown',
            },
            null,
            2
          );
        }

        const documentMetadata: drive_v3.Schema$File = {
          name: args.title,
          mimeType: 'application/vnd.google-apps.document',
        };

        if (args.parentFolderId) {
          documentMetadata.parents = [args.parentFolderId];
        }

        const response = await drive.files.create({
          requestBody: documentMetadata,
          fields: 'id,name,webViewLink',
          supportsAllDrives: true,
        });

        const document = response.data;

        // Add initial content if provided.
        // NOTE: the Drive file already exists at this point, so the doc is created
        // *empty* and content is a second API call. If that second call fails we must
        // NOT report success — doing so silently leaves an empty document. Surface the
        // failure loudly, including the doc id/url so the caller can append to the
        // existing doc instead of creating a duplicate.
        let contentInserted = false;
        if (args.initialContent) {
          try {
            const docs = await getDocsClient();
            if (args.contentFormat === 'raw') {
              await docs.documents.batchUpdate({
                documentId: document.id!,
                requestBody: {
                  requests: [
                    {
                      insertText: {
                        location: { index: 1 },
                        text: args.initialContent,
                      },
                    },
                  ],
                },
              });
            } else {
              const result = await insertMarkdown(docs, document.id!, args.initialContent, {
                startIndex: 1,
                firstHeadingAsTitle: true,
              });
              log.info(formatInsertResult(result));
            }
            contentInserted = true;
          } catch (contentError: any) {
            const detail = contentError?.message || String(contentError);
            log.error(`Document created but failed to add initial content: ${detail}`);
            throw new UserError(
              `Document "${document.name}" was created (id: ${document.id}, url: ${document.webViewLink}) ` +
                `but inserting the initial content FAILED, so it is currently EMPTY. ` +
                `Append the content to this existing document (do not create a new one). ` +
                `Underlying error: ${detail}`
            );
          }
        }

        return JSON.stringify(
          {
            id: document.id,
            name: document.name,
            url: document.webViewLink,
            contentInserted,
          },
          null,
          2
        );
      } catch (error: any) {
        // Pass through UserErrors we raised above (e.g. created-but-empty) unchanged.
        if (error instanceof UserError) throw error;
        log.error(`Error creating document: ${error.message || error}`);
        if (error.code === 404)
          throw new UserError('Parent folder not found. Check the folder ID.');
        if (error.code === 403)
          throw new UserError(
            'Permission denied. Make sure you have write access to the destination folder.'
          );
        throw new UserError(`Failed to create document: ${error.message || 'Unknown error'}`);
      }
    },
  });
}

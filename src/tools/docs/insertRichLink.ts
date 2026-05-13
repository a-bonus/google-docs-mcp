import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { docs_v1 } from 'googleapis';
import { getDocsClient } from '../../clients.js';
import { DocumentIdParameter } from '../../types.js';
import * as GDocsHelpers from '../../googleDocsApiHelpers.js';

interface RichLinkProperties {
  uri: string;
  mimeType?: string;
  title?: string;
}

interface RichLinkRequest extends docs_v1.Schema$Request {
  insertRichLink: {
    location: docs_v1.Schema$Location;
    richLinkProperties: RichLinkProperties;
  };
}

export function register(server: FastMCP) {
  server.addTool({
    name: 'insertRichLink',
    description:
      'Inserts a Google Docs rich link smart chip at a specific paragraph location. Use for Google resource links such as Drive files or Calendar events.',
    parameters: DocumentIdParameter.extend({
      index: z
        .number()
        .int()
        .min(1)
        .describe(
          '1-based character index within an existing paragraph where the rich link should be inserted.'
        ),
      uri: z.string().url().describe('URI of the Google resource for the rich link smart chip.'),
      mimeType: z
        .string()
        .optional()
        .describe('Optional MIME type of the linked resource, if known.'),
      title: z
        .string()
        .optional()
        .describe(
          'Optional title hint. Google Docs may still resolve and display the canonical resource title.'
        ),
      tabId: z.string().optional().describe('Optional target tab ID.'),
    }),
    execute: async (args, { log }) => {
      const docs = await getDocsClient();
      log.info(
        `Inserting rich link into ${args.documentId} at index ${args.index}${args.tabId ? ` (tab: ${args.tabId})` : ''}`
      );

      try {
        if (args.tabId) {
          const docInfo = await docs.documents.get({
            documentId: args.documentId,
            includeTabsContent: true,
            fields: 'tabs(tabProperties,documentTab(body))',
          });
          const targetTab = GDocsHelpers.findTabById(docInfo.data, args.tabId);
          if (!targetTab) throw new UserError(`Tab with ID "${args.tabId}" not found in document.`);
          if (!targetTab.documentTab) {
            throw new UserError(
              `Tab "${args.tabId}" does not have content (may not be a document tab).`
            );
          }
        }

        const location: Record<string, unknown> = { index: args.index };
        if (args.tabId) location.tabId = args.tabId;

        const request: RichLinkRequest = {
          insertRichLink: {
            location: location as docs_v1.Schema$Location,
            richLinkProperties: {
              uri: args.uri,
              mimeType: args.mimeType,
              title: args.title,
            },
          },
        };

        await GDocsHelpers.executeBatchUpdate(docs, args.documentId, [request]);
        return `Successfully inserted a rich link at index ${args.index}${args.tabId ? ` in tab ${args.tabId}` : ''}.`;
      } catch (error: any) {
        log.error(
          `Error inserting rich link into doc ${args.documentId}: ${error.message || error}`
        );
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to insert rich link: ${error.message || 'Unknown error'}`);
      }
    },
  });
}

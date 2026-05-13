import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { docs_v1 } from 'googleapis';
import { getDocsClient } from '../../clients.js';
import { DocumentIdParameter } from '../../types.js';
import * as GDocsHelpers from '../../googleDocsApiHelpers.js';

export function register(server: FastMCP) {
  server.addTool({
    name: 'insertText',
    description:
      "Inserts text at a specific character index within a document. Use readDocument with format='json' to determine the correct index.",
    parameters: DocumentIdParameter.extend({
      text: z.string().min(1).describe('The text to insert.'),
      index: z
        .number()
        .int()
        .min(1)
        .describe(
          "1-based character index within the document body. Use readDocument with format='json' to inspect indices."
        ),
      tabId: z
        .string()
        .optional()
        .describe(
          'The ID of the specific tab to insert into. If not specified, inserts into the first tab (or legacy document.body for documents without tabs).'
        ),
    }),
    execute: async (args, { log }) => {
      const docs = await getDocsClient();
      log.info(
        `Inserting text in doc ${args.documentId} at index ${args.index}${args.tabId ? ` (tab: ${args.tabId})` : ''}`
      );
      try {
        if (args.tabId) {
          // For tab-specific inserts, we need to verify the tab exists first
          const docInfo = await docs.documents.get({
            documentId: args.documentId,
            includeTabsContent: true,
            fields: 'tabs(tabProperties,documentTab(body),childTabs(tabProperties,documentTab(body),childTabs(tabProperties,documentTab(body))))',
          });
          const targetTab = GDocsHelpers.findTabById(docInfo.data, args.tabId);
          if (!targetTab) {
            throw new UserError(`Tab with ID "${args.tabId}" not found in document.`);
          }
          if (!targetTab.documentTab) {
            throw new UserError(
              `Tab "${args.tabId}" does not have content (may not be a document tab).`
            );
          }

          // Insert with tabId
          const location: any = { index: args.index, tabId: args.tabId };
          const request: docs_v1.Schema$Request = {
            insertText: { location, text: args.text },
          };
          await GDocsHelpers.executeBatchUpdate(docs, args.documentId, [request]);
        } else {
          // Use existing helper for backward compatibility
          await GDocsHelpers.insertText(docs, args.documentId, args.text, args.index);
        }
        return `Successfully inserted text at index ${args.index}${args.tabId ? ` in tab ${args.tabId}` : ''}.`;
      } catch (error: any) {
        log.error(`Error inserting text in doc ${args.documentId}: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to insert text: ${error.message || 'Unknown error'}`);
      }
    },
  });
}

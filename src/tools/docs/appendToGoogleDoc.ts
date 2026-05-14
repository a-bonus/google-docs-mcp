import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { docs_v1 } from 'googleapis';
import { getDocsClient } from '../../clients.js';
import { DocumentIdParameter, NotImplementedError } from '../../types.js';
import * as GDocsHelpers from '../../googleDocsApiHelpers.js';
import { TAB_BODY_END_INDEX_FIELDS } from './tabFieldMasks.js';

export function register(server: FastMCP) {
  server.addTool({
    name: 'appendText',
    description:
      'Appends plain text to the end of a document. For formatted content, use appendMarkdown instead.',
    parameters: DocumentIdParameter.extend({
      text: z.string().min(1).describe('The plain text to append to the end of the document.'),
      addNewlineIfNeeded: z
        .boolean()
        .optional()
        .default(true)
        .describe(
          "Automatically add a newline before the appended text if the doc doesn't end with one."
        ),
      tabId: z
        .string()
        .optional()
        .describe(
          'The ID of the specific tab to append to. If not specified, appends to the first tab (or legacy document.body for documents without tabs).'
        ),
    }),
    execute: async (args, { log }) => {
      const docs = await getDocsClient();
      log.info(
        `Appending to Google Doc: ${args.documentId}${args.tabId ? ` (tab: ${args.tabId})` : ''}`
      );

      try {
        // Determine if we need tabs content
        const needsTabsContent = !!args.tabId;

        // Get the current end index
        const docInfo = await docs.documents.get({
          documentId: args.documentId,
          includeTabsContent: needsTabsContent,
          suggestionsViewMode: 'PREVIEW_WITHOUT_SUGGESTIONS',
          fields: needsTabsContent
            ? TAB_BODY_END_INDEX_FIELDS
            : 'body(content(endIndex)),documentStyle(pageSize)',
        });

        let endIndex = 1;
        let bodyContent: any;

        // If tabId is specified, find the specific tab
        if (args.tabId) {
          const targetTab = GDocsHelpers.findTabById(docInfo.data, args.tabId);
          if (!targetTab) {
            throw new UserError(`Tab with ID "${args.tabId}" not found in document.`);
          }
          if (!targetTab.documentTab) {
            throw new UserError(
              `Tab "${args.tabId}" does not have content (may not be a document tab).`
            );
          }
          bodyContent = targetTab.documentTab.body?.content;
        } else {
          bodyContent = docInfo.data.body?.content;
        }

        if (bodyContent) {
          const lastElement = bodyContent[bodyContent.length - 1];
          if (lastElement?.endIndex) {
            endIndex = lastElement.endIndex - 1; // Insert *before* the final newline of the doc typically
          }
        }

        // Simpler approach: Always assume insertion is needed unless explicitly told not to add newline
        const textToInsert = (args.addNewlineIfNeeded && endIndex > 1 ? '\n' : '') + args.text;

        if (!textToInsert) return 'Nothing to append.';

        const location: any = { index: endIndex };
        if (args.tabId) {
          location.tabId = args.tabId;
        }

        const request: docs_v1.Schema$Request = {
          insertText: { location, text: textToInsert },
        };
        await GDocsHelpers.executeBatchUpdate(docs, args.documentId, [request]);

        log.info(
          `Successfully appended to doc: ${args.documentId}${args.tabId ? ` (tab: ${args.tabId})` : ''}`
        );
        return `Successfully appended text to ${args.tabId ? `tab ${args.tabId} in ` : ''}document ${args.documentId}.`;
      } catch (error: any) {
        log.error(`Error appending to doc ${args.documentId}: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        if (error instanceof NotImplementedError) throw error;
        throw new UserError(`Failed to append to doc: ${error.message || 'Unknown error'}`);
      }
    },
  });
}

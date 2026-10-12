import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { docs_v1 } from 'googleapis';
import { getDocsClient } from '../../clients.js';
import { DocumentIdParameter } from '../../types.js';
import * as GDocsHelpers from '../../googleDocsApiHelpers.js';
import { suggestModeNote, toUserError, validateSuggestModeRequests } from '../../suggestions.js';

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
      suggestMode: z
        .boolean()
        .optional()
        .default(false)
        .describe('When true, insert as a pending suggestion for review instead of a direct edit.'),
    }),
    execute: async (args, { log }) => {
      const docs = await getDocsClient();
      log.info(
        `Inserting text in doc ${args.documentId} at index ${args.index}${args.tabId ? ` (tab: ${args.tabId})` : ''}${args.suggestMode ? ' [suggestMode]' : ''}`
      );
      try {
        const location: any = { index: args.index, ...(args.tabId ? { tabId: args.tabId } : {}) };
        const request: docs_v1.Schema$Request = {
          insertText: { location, text: args.text },
        };
        if (args.suggestMode) {
          const problem = validateSuggestModeRequests([request]);
          if (problem) throw new UserError(problem);
        }
        if (args.tabId) {
          const targetTab = await GDocsHelpers.getDocumentTab(docs, args.documentId, args.tabId);

          // Insert with tabId
          await GDocsHelpers.executeBatchUpdate(docs, args.documentId, [request], {
            suggestMode: args.suggestMode,
          });
        } else {
          // Use existing helper for backward compatibility (direct path keeps old behaviour)
          if (args.suggestMode) {
            const res: any = await GDocsHelpers.executeBatchUpdate(
              docs,
              args.documentId,
              [request],
              {
                suggestMode: true,
              }
            );
            return (
              `Successfully inserted text at index ${args.index}${args.tabId ? ` in tab ${args.tabId}` : ''} as a suggestion.` +
              suggestModeNote(true, res?.commentUpdateState, res?.suggestionResponses)
            );
          }
          await GDocsHelpers.insertText(docs, args.documentId, args.text, args.index);
        }
        if (args.suggestMode) {
          return `Successfully inserted text at index ${args.index}${args.tabId ? ` in tab ${args.tabId}` : ''} as a suggestion. Verify with listSuggestions.`;
        }
        return `Successfully inserted text at index ${args.index}${args.tabId ? ` in tab ${args.tabId}` : ''}.`;
      } catch (error: any) {
        log.error(`Error inserting text in doc ${args.documentId}: ${error.message || error}`);
        toUserError(error, 'Failed to insert text');
      }
    },
  });
}

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
    name: 'deleteRange',
    description:
      "Deletes content within a character range [startIndex, endIndex) from a document. Use readDocument with format='json' to determine index positions.",
    parameters: DocumentIdParameter.extend({
      startIndex: z
        .number()
        .int()
        .min(1)
        .describe(
          '1-based character index within the document body. The start of the range to delete (inclusive).'
        ),
      endIndex: z
        .number()
        .int()
        .min(1)
        .describe(
          '1-based character index within the document body. The end of the range to delete (exclusive).'
        ),
      tabId: z
        .string()
        .optional()
        .describe(
          'The ID of the specific tab to delete from. If not specified, deletes from the first tab (or legacy document.body for documents without tabs).'
        ),
      suggestMode: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          'When true, propose the deletion as a pending suggestion for review instead of deleting directly.'
        ),
    }).refine((data) => data.endIndex > data.startIndex, {
      message: 'endIndex must be greater than startIndex',
      path: ['endIndex'],
    }),
    execute: async (args, { log }) => {
      const docs = await getDocsClient();
      log.info(
        `Deleting range ${args.startIndex}-${args.endIndex} in doc ${args.documentId}${args.tabId ? ` (tab: ${args.tabId})` : ''}${args.suggestMode ? ' [suggestMode]' : ''}`
      );
      if (args.endIndex <= args.startIndex) {
        throw new UserError('End index must be greater than start index for deletion.');
      }
      try {
        // If tabId is specified, verify the tab exists
        if (args.tabId) {
          const targetTab = await GDocsHelpers.getDocumentTab(docs, args.documentId, args.tabId);
        }

        const range: any = {
          startIndex: args.startIndex,
          endIndex: args.endIndex,
        };
        if (args.tabId) {
          range.tabId = args.tabId;
        }

        const request: docs_v1.Schema$Request = {
          deleteContentRange: { range },
        };
        if (args.suggestMode) {
          const problem = validateSuggestModeRequests([request]);
          if (problem) throw new UserError(problem);
        }
        const res: any = await GDocsHelpers.executeBatchUpdate(docs, args.documentId, [request], {
          suggestMode: args.suggestMode,
        });
        const base = `Successfully deleted content in range ${args.startIndex}-${args.endIndex}${args.tabId ? ` in tab ${args.tabId}` : ''}`;
        if (args.suggestMode) {
          return (
            base +
            ' as a suggestion.' +
            suggestModeNote(true, res?.commentUpdateState, res?.suggestionResponses)
          );
        }
        return base + '.';
      } catch (error: any) {
        log.error(`Error deleting range in doc ${args.documentId}: ${error.message || error}`);
        toUserError(error, 'Failed to delete range');
      }
    },
  });
}

import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { docs_v1 } from 'googleapis';
import { getDocsClient } from '../../clients.js';
import { DocumentIdParameter } from '../../types.js';
import * as GDocsHelpers from '../../googleDocsApiHelpers.js';
import { suggestModeNote, toUserError, validateSuggestModeRequests } from '../../suggestions.js';

const FindAndReplaceParameters = DocumentIdParameter.extend({
  findText: z.string().min(1).describe('The text to search for in the document.'),
  replaceText: z
    .string()
    .describe('The replacement text. Use an empty string to delete all occurrences.'),
  matchCase: z
    .boolean()
    .optional()
    .describe('Whether the search should be case-sensitive. Defaults to false.'),
  tabId: z
    .string()
    .optional()
    .describe('Scope replacement to a specific tab. If omitted, replaces across all tabs.'),
  suggestMode: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'When true, propose replacements as pending suggestions for review instead of replacing directly.'
    ),
});

export function register(server: FastMCP) {
  server.addTool({
    name: 'findAndReplace',
    description:
      'Replaces all occurrences of a text string throughout the document (or a specific tab). ' +
      'Returns the number of replacements made. Use an empty replaceText to delete all matches.',
    parameters: FindAndReplaceParameters,
    execute: async (args, { log }) => {
      const docs = await getDocsClient();
      log.info(
        `findAndReplace in doc ${args.documentId}: "${args.findText}" → "${args.replaceText}"` +
          `${args.matchCase ? ' (case-sensitive)' : ''}` +
          `${args.tabId ? ` (tab: ${args.tabId})` : ''}`
      );

      try {
        const request: docs_v1.Schema$Request = {
          replaceAllText: {
            containsText: {
              text: args.findText,
              matchCase: args.matchCase ?? false,
            },
            replaceText: args.replaceText,
            ...(args.tabId && { tabsCriteria: { tabIds: [args.tabId] } }),
          },
        };

        if (args.suggestMode) {
          const problem = validateSuggestModeRequests([request]);
          if (problem) throw new UserError(problem);
        }
        const response: any = await GDocsHelpers.executeBatchUpdate(
          docs,
          args.documentId,
          [request],
          {
            suggestMode: args.suggestMode,
          }
        );
        const changed = response.replies?.[0]?.replaceAllText?.occurrencesChanged ?? 0;

        const base = `Replaced ${changed} occurrence(s) of "${args.findText}" with "${args.replaceText}"`;
        if (args.suggestMode) {
          return (
            base +
            ' as suggestions.' +
            suggestModeNote(true, response?.commentUpdateState, response?.suggestionResponses, {
              allNoops: changed === 0,
            })
          );
        }
        return base + '.';
      } catch (error: any) {
        log.error(`Error in findAndReplace for doc ${args.documentId}: ${error.message || error}`);
        toUserError(error, 'Failed to find and replace');
      }
    },
  });
}

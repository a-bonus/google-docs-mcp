import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { getDocsClient } from '../../clients.js';
import { DocumentIdParameter } from '../../types.js';
import type { docs_v1 } from 'googleapis';
import * as GDocsHelpers from '../../googleDocsApiHelpers.js';
import { toUserError } from '../../suggestions.js';

const ACTION_TO_KEY = {
  accept: 'acceptSuggestion',
  reject: 'rejectSuggestion',
  delete: 'deleteSuggestion',
} as const;

export function register(server: FastMCP) {
  server.addTool({
    name: 'manageSuggestions',
    description:
      'Accepts, rejects or deletes pending suggestion threads in a Google Doc (created in Suggesting mode or via suggestMode=true writes). Call listSuggestions first to get suggestion IDs.',
    parameters: DocumentIdParameter.extend({
      action: z
        .enum(['accept', 'reject', 'delete'])
        .describe(
          "'accept' applies the suggestion (needs edit access), 'reject' discards it (needs edit access or authorship), 'delete' removes the thread (needs authorship)."
        ),
      suggestionIds: z
        .array(z.string().min(1))
        .min(1)
        .describe(
          'One or more suggestion thread IDs from listSuggestions (e.g. suggest.vcti8ewm4mww).'
        ),
    }),
    execute: async (args, { log }) => {
      const docs = await getDocsClient();
      log.info(
        `Managing suggestions in doc ${args.documentId}: action=${args.action}, ids=${args.suggestionIds.length}`
      );
      try {
        const key = ACTION_TO_KEY[args.action as keyof typeof ACTION_TO_KEY];
        if (!key) throw new UserError(`action must be one of 'accept', 'reject', 'delete'`);
        const requests: docs_v1.Schema$Request[] = args.suggestionIds.map((sid) =>
          key === 'acceptSuggestion'
            ? { acceptSuggestion: { suggestionId: sid } }
            : key === 'rejectSuggestion'
              ? { rejectSuggestion: { suggestionId: sid } }
              : { deleteSuggestion: { suggestionId: sid } }
        );
        const res = await GDocsHelpers.executeBatchUpdate(docs, args.documentId, requests);
        const state = res?.commentUpdateState;
        const link = `https://docs.google.com/document/d/${args.documentId}/edit`;
        if (state === 'ALL_SAVED') {
          return `Successfully applied '${args.action}' to ${args.suggestionIds.length} suggestion(s) in document ${args.documentId}. Link: ${link}`;
        }
        return (
          `Requested '${args.action}' on ${args.suggestionIds.length} suggestion(s), but the API did not confirm ` +
          `the change was saved (comment_update_state: ${state ?? 'MISSING'}). Re-check with listSuggestions before assuming it applied. Link: ${link}`
        );
      } catch (error: any) {
        log.error(
          `Error managing suggestions in doc ${args.documentId}: ${error.message || error}`
        );
        toUserError(error, 'Failed to manage suggestions');
      }
    },
  });
}

import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import type { docs_v1 } from 'googleapis';
import { getDocsClient } from '../../../clients.js';
import { BatchApplyTextStyleToolParameters, BatchApplyTextStyleToolArgs } from '../../../types.js';
import * as GDocsHelpers from '../../../googleDocsApiHelpers.js';
import { suggestModeNote, toUserError, validateSuggestModeRequests } from '../../../suggestions.js';

// Mirrors MAX_BATCH_UPDATE_REQUESTS in googleDocsApiHelpers.ts — Google's own
// per-batchUpdate-call request ceiling, not an arbitrary choice.
const MAX_REQUESTS_PER_CALL = 50;

export function register(server: FastMCP) {
  server.addTool({
    name: 'batchApplyTextStyle',
    description:
      'Applies character-level formatting (bold, italic, color, font, etc.) to MANY ranges in a single tool ' +
      'call, instead of one applyTextStyle call per range. Built for scripts that colour dozens or hundreds of ' +
      'cues: do one readDocument (format="json") pass, compute every range from that one read, then pass them ' +
      'all here as one operations[] array. Internally chunks into batches of up to 50 requests per Docs API ' +
      "call (Google's per-request-array limit), so 100+ operations still cost only 2-3 API calls instead of " +
      '100+ round trips.',
    parameters: BatchApplyTextStyleToolParameters,
    execute: async (args: BatchApplyTextStyleToolArgs, { log }) => {
      const docs = await getDocsClient();

      log.info(
        `Batch-applying text style in doc ${args.documentId}${args.tabId ? ` (tab: ${args.tabId})` : ''}. Operations: ${args.operations.length}`
      );

      const requests: docs_v1.Schema$Request[] = [];
      const skipped: { index: number; reason: string }[] = [];
      const fieldsSeen = new Set<string>();

      for (let i = 0; i < args.operations.length; i++) {
        const op = args.operations[i];
        let startIndex: number | undefined;
        let endIndex: number | undefined;

        try {
          if ('textToFind' in op.target) {
            const range = await GDocsHelpers.findTextRange(
              docs,
              args.documentId,
              op.target.textToFind,
              op.target.matchInstance,
              args.tabId
            );
            if (!range) {
              skipped.push({
                index: i,
                reason: `Could not find instance ${op.target.matchInstance} of text "${op.target.textToFind}".`,
              });
              continue;
            }
            startIndex = range.startIndex;
            endIndex = range.endIndex;
          } else {
            startIndex = op.target.startIndex;
            endIndex = op.target.endIndex;
          }

          if (startIndex === undefined || endIndex === undefined || endIndex <= startIndex) {
            skipped.push({ index: i, reason: 'Target range could not be determined.' });
            continue;
          }

          const requestInfo = GDocsHelpers.buildUpdateTextStyleRequest(
            startIndex,
            endIndex,
            op.style,
            args.tabId
          );
          if (!requestInfo) {
            skipped.push({ index: i, reason: 'No valid text styling options were provided.' });
            continue;
          }
          requests.push(requestInfo.request);
          requestInfo.fields.forEach((f) => fieldsSeen.add(f));
        } catch (error: any) {
          skipped.push({ index: i, reason: error.message || 'Unknown error resolving target.' });
        }
      }

      if (requests.length === 0) {
        throw new UserError(`No operations could be applied. Skipped: ${JSON.stringify(skipped)}`);
      }

      if ((args as any).suggestMode) {
        const problem = validateSuggestModeRequests(requests);
        if (problem) throw new UserError(problem);
      }
      let apiCalls = 0;
      let commentUpdateState: string | undefined;
      const suggestionResponses: any[] = [];
      const totalChunks = Math.ceil(requests.length / MAX_REQUESTS_PER_CALL);
      try {
        for (let i = 0; i < requests.length; i += MAX_REQUESTS_PER_CALL) {
          const chunk = requests.slice(i, i + MAX_REQUESTS_PER_CALL);
          const res: any = await GDocsHelpers.executeBatchUpdate(docs, args.documentId, chunk, {
            suggestMode: (args as any).suggestMode,
          });
          if (Array.isArray(res?.suggestionResponses))
            suggestionResponses.push(...res.suggestionResponses);
          if (res?.commentUpdateState) commentUpdateState = res.commentUpdateState;
          apiCalls++;
        }
      } catch (error: any) {
        throw new UserError(
          `Batch failed after ${apiCalls} of ${totalChunks} chunk(s) succeeded ` +
            `(${Math.min(apiCalls * MAX_REQUESTS_PER_CALL, requests.length)} of ${requests.length} operations ` +
            `applied before the error). Error: ${error.message || error}`
        );
      }

      const summary =
        `Applied ${requests.length}/${args.operations.length} text style operation(s) ` +
        `(${Array.from(fieldsSeen).join(', ')}) to doc ${args.documentId} in ${apiCalls} Docs API call(s)` +
        ((args as any).suggestMode
          ? ' as suggestions.' + suggestModeNote(true, commentUpdateState, suggestionResponses)
          : '.');

      if (skipped.length > 0) {
        return `${summary} Skipped ${skipped.length}: ${JSON.stringify(skipped)}`;
      }
      return summary;
    },
  });
}

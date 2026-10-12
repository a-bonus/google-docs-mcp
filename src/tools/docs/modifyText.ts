import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { docs_v1 } from 'googleapis';
import { getDocsClient } from '../../clients.js';
import { DocumentIdParameter, TextFindParameter, TextStyleParameters } from '../../types.js';
import type { TextStyleArgs } from '../../types.js';
import * as GDocsHelpers from '../../googleDocsApiHelpers.js';
import { suggestModeNote, toUserError, validateSuggestModeRequests } from '../../suggestions.js';

const RangeTarget = z
  .object({
    startIndex: z.number().int().min(1).describe('Start of range (inclusive, 1-based).'),
    endIndex: z.number().int().min(1).describe('End of range (exclusive).'),
  })
  .refine((d) => d.endIndex > d.startIndex, {
    message: 'endIndex must be greater than startIndex',
    path: ['endIndex'],
  });

const InsertionTarget = z.strictObject({
  insertionIndex: z.number().int().min(1).describe('Index to insert at (1-based).'),
});

const ModifyTextParameters = DocumentIdParameter.extend({
  target: z
    .union([RangeTarget, TextFindParameter, InsertionTarget])
    .describe('Target by range indices, text search, or insertion index.'),
  text: z.string().optional().describe('New text to insert or replace with.'),
  style: TextStyleParameters.optional().describe('Text formatting to apply.'),
  tabId: z
    .string()
    .optional()
    .describe(
      'The ID of the specific tab to operate on. If not specified, operates on the first tab.'
    ),
  suggestMode: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'When true, apply the modification as pending suggestions for review instead of direct edits.'
    ),
})
  .refine((args) => args.text !== undefined || args.style !== undefined, {
    message: 'At least one of text or style must be provided.',
  })
  .refine(
    (args) => {
      if ('insertionIndex' in args.target && args.text === undefined) return false;
      return true;
    },
    { message: 'text is required when using insertionIndex target (no existing range to format).' }
  );

export interface BuildModifyTextOpts {
  startIndex: number;
  endIndex?: number;
  text?: string;
  style?: TextStyleArgs;
  tabId?: string;
}

/**
 * Pure, sync function that builds the array of Google Docs API requests for a
 * modifyText operation. Indices must already be resolved (no text-search here).
 */
export function buildModifyTextRequests(opts: BuildModifyTextOpts): docs_v1.Schema$Request[] {
  const { startIndex, endIndex, text, style, tabId } = opts;
  const requests: docs_v1.Schema$Request[] = [];

  if (!text && !style) return requests;

  // 1. Delete existing content (only when replacing, not insert-only)
  if (endIndex !== undefined && text !== undefined) {
    const range: any = { startIndex, endIndex };
    if (tabId) range.tabId = tabId;
    requests.push({ deleteContentRange: { range } });
  }

  // 2. Insert new text
  if (text !== undefined) {
    const location: any = { index: startIndex };
    if (tabId) location.tabId = tabId;
    requests.push({ insertText: { location, text } });
  }

  // 3. Apply formatting
  if (style) {
    const formatStart = startIndex;
    const formatEnd =
      text !== undefined
        ? startIndex + text.length
        : endIndex !== undefined
          ? endIndex
          : startIndex;

    if (formatEnd > formatStart) {
      const requestInfo = GDocsHelpers.buildUpdateTextStyleRequest(
        formatStart,
        formatEnd,
        style,
        tabId
      );
      if (requestInfo) {
        requests.push(requestInfo.request);
      }
    }
  }

  return requests;
}

export function register(server: FastMCP) {
  server.addTool({
    name: 'modifyText',
    description:
      'Combines text replacement/insertion and formatting in one atomic operation. ' +
      'Can insert text at a position, replace a range or found text, apply formatting, ' +
      "or any combination. Use readGoogleDoc with format='json' to determine indices.",
    parameters: ModifyTextParameters,
    execute: async (args, { log }) => {
      const docs = await getDocsClient();
      log.info(
        `modifyText on doc ${args.documentId}: target=${JSON.stringify(args.target)}` +
          `${args.text !== undefined ? `, text="${args.text.substring(0, 50)}"` : ''}` +
          `${args.style ? `, style=${JSON.stringify(args.style)}` : ''}` +
          `${args.tabId ? `, tab=${args.tabId}` : ''}`
      );

      try {
        // Verify tab exists if specified
        if (args.tabId) {
          const targetTab = await GDocsHelpers.getDocumentTab(docs, args.documentId, args.tabId);
        }

        // Resolve target to numeric indices
        let startIndex: number;
        let endIndex: number | undefined;

        if ('insertionIndex' in args.target) {
          startIndex = args.target.insertionIndex;
          endIndex = undefined;
        } else if ('textToFind' in args.target) {
          const range = await GDocsHelpers.findTextRange(
            docs,
            args.documentId,
            args.target.textToFind,
            args.target.matchInstance,
            args.tabId
          );
          if (!range) {
            throw new UserError(
              `Could not find instance ${args.target.matchInstance ?? 1} of text "${args.target.textToFind}"${args.tabId ? ` in tab ${args.tabId}` : ''}.`
            );
          }
          startIndex = range.startIndex;
          endIndex = range.endIndex;
          log.info(`Found text "${args.target.textToFind}" at range ${startIndex}-${endIndex}`);
        } else {
          startIndex = (args.target as { startIndex: number; endIndex: number }).startIndex;
          endIndex = (args.target as { startIndex: number; endIndex: number }).endIndex;
        }

        // Clamp to minimum 1 (index 0 is the document section break)
        if (startIndex < 1) startIndex = 1;

        const requests = buildModifyTextRequests({
          startIndex,
          endIndex,
          text: args.text,
          style: args.style,
          tabId: args.tabId,
        });

        if (requests.length === 0) {
          return 'No operations to perform.';
        }

        if (args.suggestMode) {
          const problem = validateSuggestModeRequests(requests);
          if (problem) throw new UserError(problem);
        }
        const res: any = await GDocsHelpers.executeBatchUpdate(docs, args.documentId, requests, {
          suggestMode: args.suggestMode,
        });

        // Build descriptive result
        const actions: string[] = [];
        if (endIndex !== undefined && args.text !== undefined) actions.push('replaced text');
        else if (args.text !== undefined) actions.push('inserted text');
        if (args.style) actions.push('applied formatting');

        const base = `Successfully ${actions.join(' and ')} at range ${startIndex}-${endIndex ?? startIndex + (args.text?.length ?? 0)}${args.tabId ? ` in tab ${args.tabId}` : ''}`;
        if (args.suggestMode) {
          return (
            base +
            ' as suggestions.' +
            suggestModeNote(true, res?.commentUpdateState, res?.suggestionResponses)
          );
        }
        return base + '.';
      } catch (error: any) {
        log.error(`Error in modifyText for doc ${args.documentId}: ${error.message || error}`);
        toUserError(error, 'Failed to modify text');
      }
    },
  });
}

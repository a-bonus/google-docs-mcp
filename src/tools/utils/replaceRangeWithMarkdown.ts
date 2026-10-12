import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { getDocsClient } from '../../clients.js';
import { DocumentIdParameter, MarkdownConversionError } from '../../types.js';
import * as GDocsHelpers from '../../googleDocsApiHelpers.js';
import { suggestModeNote, validateSuggestModeRequests } from '../../suggestions.js';
import { insertMarkdown, formatInsertResult } from '../../markdown-transformer/index.js';

export function register(server: FastMCP) {
  server.addTool({
    name: 'replaceRangeWithMarkdown',
    description:
      "Replaces a specific character range in a document with formatted markdown content. Use readDocument with format='json' to determine the start and end indices of the content you want to replace. Supports headings, bold, italic, strikethrough, links, bullet/numbered lists, code blocks, horizontal rules, and tables.",
    parameters: DocumentIdParameter.extend({
      startIndex: z
        .number()
        .int()
        .min(1)
        .describe(
          "1-based character index where the replacement range begins (inclusive). Use readDocument with format='json' to find the correct index."
        ),
      endIndex: z
        .number()
        .int()
        .min(1)
        .describe(
          "1-based character index where the replacement range ends (exclusive). Use readDocument with format='json' to find the correct index."
        ),
      markdown: z
        .string()
        .min(1)
        .describe('The markdown content to insert in place of the deleted range.'),
      tabId: z
        .string()
        .optional()
        .describe(
          'The ID of the specific tab to modify. If not specified, modifies the first tab.'
        ),
      suggestMode: z
        .boolean()
        .optional()
        .default(false)
        .describe('When true, apply as pending suggestions for review instead of direct edits.'),
    }).refine((data) => data.endIndex > data.startIndex, {
      message: 'endIndex must be greater than startIndex',
      path: ['endIndex'],
    }),
    execute: async (args, { log }) => {
      const docs = await getDocsClient();
      log.info(
        `Replacing range ${args.startIndex}-${args.endIndex} in doc ${args.documentId} with markdown (${args.markdown.length} chars)${args.tabId ? ` in tab ${args.tabId}` : ''}`
      );

      try {
        if (args.suggestMode) {
        }
        // 1. Delete the existing content in the specified range
        const deleteRange: any = {
          startIndex: args.startIndex,
          endIndex: args.endIndex,
        };
        if (args.tabId) {
          deleteRange.tabId = args.tabId;
        }

        log.info(`Deleting content from index ${args.startIndex} to ${args.endIndex}`);
        await GDocsHelpers.executeBatchUpdate(
          docs,
          args.documentId,
          [
            {
              deleteContentRange: { range: deleteRange },
            },
          ],
          { suggestMode: args.suggestMode }
        );
        log.info(`Delete complete.`);

        // 2. Insert markdown at the start position (which is now where the deleted content was)
        log.info(`Inserting markdown at index ${args.startIndex}`);
        const result = await insertMarkdown(docs, args.documentId, args.markdown, {
          startIndex: args.startIndex,
          tabId: args.tabId,
          suggestMode: args.suggestMode,
        });

        const debugSummary = formatInsertResult(result);
        log.info(debugSummary);
        const base = `Successfully replaced range ${args.startIndex}-${args.endIndex} with ${args.markdown.length} characters of markdown.\n\n${debugSummary}`;
        if (args.suggestMode) {
          return (
            base +
            suggestModeNote(
              true,
              (result.batchUpdate as any)?.commentUpdateState,
              (result.batchUpdate as any)?.suggestionResponses
            )
          );
        }
        return base;
      } catch (error: any) {
        log.error(`Error replacing range with markdown: ${error.message}`);
        if (error instanceof UserError || error instanceof MarkdownConversionError) {
          throw error;
        }
        throw new UserError(
          `Failed to replace range with markdown: ${error.message || 'Unknown error'}`
        );
      }
    },
  });
}

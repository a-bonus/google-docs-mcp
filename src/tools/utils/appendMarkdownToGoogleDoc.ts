import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { getDocsClient } from '../../clients.js';
import { DocumentIdParameter, MarkdownConversionError } from '../../types.js';
import * as GDocsHelpers from '../../googleDocsApiHelpers.js';
import { suggestModeNote, validateSuggestModeRequests } from '../../suggestions.js';
import { insertMarkdown, formatInsertResult } from '../../markdown-transformer/index.js';
import { TAB_BODY_END_INDEX_FIELDS } from '../docs/tabFieldMasks.js';

export function register(server: FastMCP) {
  server.addTool({
    name: 'appendMarkdown',
    description:
      'Appends formatted content to the end of a document using markdown syntax. Supports headings, bold, italic, strikethrough, links, and bullet/numbered lists. Use this instead of appendText when you need formatting.',
    parameters: DocumentIdParameter.extend({
      markdown: z.string().min(1).describe('The markdown content to append.'),
      addNewlineIfNeeded: z
        .boolean()
        .optional()
        .default(true)
        .describe('Add spacing before appended content if needed.'),
      tabId: z
        .string()
        .optional()
        .describe(
          'The ID of the specific tab to append to. If not specified, appends to the first tab.'
        ),
      firstHeadingAsTitle: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          'If true, the first H1 heading (# ...) in the markdown is styled as a Google Docs TITLE instead of Heading 1. Useful when the markdown represents a full document whose first line is the document title.'
        ),
      suggestMode: z
        .boolean()
        .optional()
        .default(false)
        .describe('When true, apply as pending suggestions for review instead of direct edits.'),
    }),
    execute: async (args, { log }) => {
      const docs = await getDocsClient();
      log.info(
        `Appending markdown to doc ${args.documentId} (${args.markdown.length} chars)${args.tabId ? ` in tab ${args.tabId}` : ''}`
      );

      try {
        if (args.suggestMode) {
        }
        // 1. Get document end index (suggest mode needs INLINE indices per API docs)
        const doc = await docs.documents.get({
          documentId: args.documentId,
          includeTabsContent: !!args.tabId,
          suggestionsViewMode: args.suggestMode
            ? 'SUGGESTIONS_INLINE'
            : 'PREVIEW_WITHOUT_SUGGESTIONS',
          fields: args.tabId ? TAB_BODY_END_INDEX_FIELDS : 'body(content(endIndex))',
        });

        let bodyContent: any;

        if (args.tabId) {
          const targetTab = GDocsHelpers.findTabById(doc.data, args.tabId);
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
          bodyContent = doc.data.body?.content;
        }

        if (!bodyContent) {
          throw new UserError('No content found in document/tab');
        }

        let startIndex = bodyContent[bodyContent.length - 1].endIndex! - 1;
        log.info(`Document end index: ${startIndex}`);

        // 2. Add spacing if needed
        if (args.addNewlineIfNeeded && startIndex > 1) {
          const location: any = { index: startIndex };
          if (args.tabId) {
            location.tabId = args.tabId;
          }
          await GDocsHelpers.executeBatchUpdate(
            docs,
            args.documentId,
            [
              {
                insertText: {
                  location,
                  text: '\n\n',
                },
              },
            ],
            { suggestMode: args.suggestMode }
          );
          startIndex += 2;
          log.info(`Added spacing, new start index: ${startIndex}`);
        }

        // 3. Convert and append markdown
        const result = await insertMarkdown(docs, args.documentId, args.markdown, {
          startIndex,
          tabId: args.tabId,
          firstHeadingAsTitle: args.firstHeadingAsTitle,
          suggestMode: args.suggestMode,
        });

        const debugSummary = formatInsertResult(result);
        log.info(debugSummary);
        const base = `Successfully appended ${args.markdown.length} characters of markdown.\n\n${debugSummary}`;
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
        log.error(`Error appending markdown: ${error.message}`);
        if (error instanceof UserError || error instanceof MarkdownConversionError) {
          throw error;
        }
        throw new UserError(`Failed to append markdown: ${error.message}`);
      }
    },
  });
}

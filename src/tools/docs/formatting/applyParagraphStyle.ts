import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { getDocsClient } from '../../../clients.js';
import {
  ApplyParagraphStyleToolParameters,
  ApplyParagraphStyleToolArgs,
  NotImplementedError,
} from '../../../types.js';
import * as GDocsHelpers from '../../../googleDocsApiHelpers.js';
import { suggestModeNote, toUserError, validateSuggestModeRequests } from '../../../suggestions.js';

export function register(server: FastMCP) {
  server.addTool({
    name: 'applyParagraphStyle',
    description:
      'Applies paragraph-level formatting (alignment, spacing, heading styles) to paragraphs identified by a character range or by searching for text. Use namedStyleType to set heading levels (HEADING_1 through HEADING_6).',
    parameters: ApplyParagraphStyleToolParameters,
    execute: async (args: ApplyParagraphStyleToolArgs, { log }) => {
      const docs = await getDocsClient();
      let startIndex: number | undefined;
      let endIndex: number | undefined;

      log.info(
        `Applying paragraph style to document ${args.documentId}${args.tabId ? ` (tab: ${args.tabId})` : ''}`
      );
      log.info(`Style options: ${JSON.stringify(args.style)}`);
      log.info(`Target specification: ${JSON.stringify(args.target)}`);

      try {
        // STEP 1: Determine the target paragraph's range based on the targeting method
        if ('textToFind' in args.target) {
          // Find the text first
          log.info(
            `Finding text "${args.target.textToFind}" (instance ${args.target.matchInstance || 1})${args.tabId ? ` in tab ${args.tabId}` : ''}`
          );
          const textRange = await GDocsHelpers.findTextRange(
            docs,
            args.documentId,
            args.target.textToFind,
            args.target.matchInstance || 1,
            args.tabId
          );

          if (!textRange) {
            throw new UserError(
              `Could not find "${args.target.textToFind}" in the document${args.tabId ? ` (tab: ${args.tabId})` : ''}.`
            );
          }

          log.info(
            `Found text at range ${textRange.startIndex}-${textRange.endIndex}, now locating containing paragraph`
          );

          // Then find the paragraph containing this text
          const paragraphRange = await GDocsHelpers.getParagraphRange(
            docs,
            args.documentId,
            textRange.startIndex,
            args.tabId
          );

          if (!paragraphRange) {
            throw new UserError(`Found the text but could not determine the paragraph boundaries.`);
          }

          startIndex = paragraphRange.startIndex;
          endIndex = paragraphRange.endIndex;
          log.info(`Text is contained within paragraph at range ${startIndex}-${endIndex}`);
        } else if ('indexWithinParagraph' in args.target) {
          // Find paragraph containing the specified index
          log.info(
            `Finding paragraph containing index ${args.target.indexWithinParagraph}${args.tabId ? ` in tab ${args.tabId}` : ''}`
          );
          const paragraphRange = await GDocsHelpers.getParagraphRange(
            docs,
            args.documentId,
            args.target.indexWithinParagraph,
            args.tabId
          );

          if (!paragraphRange) {
            throw new UserError(
              `Could not find paragraph containing index ${args.target.indexWithinParagraph}${args.tabId ? ` in tab ${args.tabId}` : ''}.`
            );
          }

          startIndex = paragraphRange.startIndex;
          endIndex = paragraphRange.endIndex;
          log.info(`Located paragraph at range ${startIndex}-${endIndex}`);
        } else if ('startIndex' in args.target && 'endIndex' in args.target) {
          // Use directly provided range
          startIndex = args.target.startIndex;
          endIndex = args.target.endIndex;
          log.info(`Using provided paragraph range ${startIndex}-${endIndex}`);
        }

        // Verify that we have a valid range
        if (startIndex === undefined || endIndex === undefined) {
          throw new UserError(
            'Could not determine target paragraph range from the provided information.'
          );
        }

        if (endIndex <= startIndex) {
          throw new UserError(
            `Invalid paragraph range: end index (${endIndex}) must be greater than start index (${startIndex}).`
          );
        }

        // STEP 2: Build and apply the paragraph style request
        log.info(`Building paragraph style request for range ${startIndex}-${endIndex}`);
        const requestInfo = GDocsHelpers.buildUpdateParagraphStyleRequest(
          startIndex,
          endIndex,
          args.style,
          args.tabId
        );

        if (!requestInfo) {
          return 'No valid paragraph styling options were provided.';
        }

        log.info(`Applying styles: ${requestInfo.fields.join(', ')}`);
        if ((args as any).suggestMode) {
          const problem = validateSuggestModeRequests([requestInfo.request]);
          if (problem) throw new UserError(problem);
        }
        const res: any = await GDocsHelpers.executeBatchUpdate(
          docs,
          args.documentId,
          [requestInfo.request],
          {
            suggestMode: (args as any).suggestMode,
          }
        );

        const base = `Successfully applied paragraph styles (${requestInfo.fields.join(', ')}) to the paragraph${args.tabId ? ` in tab ${args.tabId}` : ''}`;
        if ((args as any).suggestMode) {
          return (
            base +
            ' as suggestions.' +
            suggestModeNote(true, res?.commentUpdateState, res?.suggestionResponses)
          );
        }
        return base + '.';
      } catch (error: any) {
        // Detailed error logging
        log.error(`Error applying paragraph style in doc ${args.documentId}:`);
        log.error(error.stack || error.message || error);

        if (error instanceof NotImplementedError) throw error;

        // Provide a more helpful error message
        toUserError(error, 'Failed to apply paragraph style');
      }
    },
  });
}

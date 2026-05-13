import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { docs_v1 } from 'googleapis';
import { getDocsClient } from '../../clients.js';
import { DocumentIdParameter } from '../../types.js';
import * as GDocsHelpers from '../../googleDocsApiHelpers.js';

export interface UpdateSectionStyleBuilderInput {
  startIndex: number;
  endIndex: number;
  flipPageOrientation?: boolean;
  sectionType?: 'SECTION_TYPE_UNSPECIFIED' | 'CONTINUOUS' | 'NEXT_PAGE';
  marginTop?: number;
  marginBottom?: number;
  marginLeft?: number;
  marginRight?: number;
  pageNumberStart?: number;
  tabId?: string;
}

export function buildUpdateSectionStyleRequest(
  params: UpdateSectionStyleBuilderInput
): { request: docs_v1.Schema$Request; fields: string[] } | null {
  const sectionStyle: docs_v1.Schema$SectionStyle = {};
  const fields: string[] = [];

  if (params.flipPageOrientation !== undefined) {
    sectionStyle.flipPageOrientation = params.flipPageOrientation;
    fields.push('flipPageOrientation');
  }
  if (params.sectionType !== undefined) {
    sectionStyle.sectionType = params.sectionType;
    fields.push('sectionType');
  }
  if (params.marginTop !== undefined) {
    sectionStyle.marginTop = { magnitude: params.marginTop, unit: 'PT' };
    fields.push('marginTop');
  }
  if (params.marginBottom !== undefined) {
    sectionStyle.marginBottom = { magnitude: params.marginBottom, unit: 'PT' };
    fields.push('marginBottom');
  }
  if (params.marginLeft !== undefined) {
    sectionStyle.marginLeft = { magnitude: params.marginLeft, unit: 'PT' };
    fields.push('marginLeft');
  }
  if (params.marginRight !== undefined) {
    sectionStyle.marginRight = { magnitude: params.marginRight, unit: 'PT' };
    fields.push('marginRight');
  }
  if (params.pageNumberStart !== undefined) {
    sectionStyle.pageNumberStart = params.pageNumberStart;
    fields.push('pageNumberStart');
  }

  if (fields.length === 0) {
    return null;
  }

  const range: any = {
    startIndex: params.startIndex,
    endIndex: params.endIndex,
  };
  if (params.tabId) {
    range.tabId = params.tabId;
  }

  return {
    request: {
      updateSectionStyle: {
        range,
        sectionStyle,
        fields: fields.join(','),
      },
    },
    fields,
  };
}

export function register(server: FastMCP) {
  server.addTool({
    name: 'updateSectionStyle',
    description:
      'Updates the style of a section identified by a character range. The range must cover the section whose style is changing — typically from the character right after an inserted section break to any index inside that section. Supports flipping page orientation (landscape <-> portrait), setting margins, and changing the section type. Common workflow for a landscape page: call insertSectionBreak with sectionType="NEXT_PAGE" before the landscape content, call insertSectionBreak again after it, then call updateSectionStyle on the range between the two breaks with flipPageOrientation=true.',
    parameters: DocumentIdParameter.extend({
      startIndex: z
        .number()
        .int()
        .min(1)
        .describe(
          'The starting index of the range covering the section to style (inclusive, 1-based). Typically the index immediately after the section break that opened this section.'
        ),
      endIndex: z
        .number()
        .int()
        .min(1)
        .describe(
          'The ending index of the range covering the section to style (exclusive). Any index inside the section works — the style applies to the whole section.'
        ),
      flipPageOrientation: z
        .boolean()
        .optional()
        .describe(
          'If true, swaps the section page width and height (effectively toggling between portrait and landscape). If false, keeps the default document orientation.'
        ),
      sectionType: z
        .enum(['SECTION_TYPE_UNSPECIFIED', 'CONTINUOUS', 'NEXT_PAGE'])
        .optional()
        .describe(
          'Changes the section type after the break. Usually set at insert time via insertSectionBreak, but can be updated here.'
        ),
      marginTop: z
        .number()
        .nonnegative()
        .optional()
        .describe('Top margin of the section in points (1 inch = 72 points).'),
      marginBottom: z
        .number()
        .nonnegative()
        .optional()
        .describe('Bottom margin of the section in points.'),
      marginLeft: z
        .number()
        .nonnegative()
        .optional()
        .describe('Left margin of the section in points.'),
      marginRight: z
        .number()
        .nonnegative()
        .optional()
        .describe('Right margin of the section in points.'),
      pageNumberStart: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe(
          'Page number to start the section from. If unset, numbering continues from the previous section.'
        ),
      tabId: z
        .string()
        .optional()
        .describe(
          'The ID of the specific tab to update. Use listDocumentTabs to get tab IDs. If not specified, targets the first tab.'
        ),
    }).refine((data) => data.endIndex > data.startIndex, {
      message: 'endIndex must be greater than startIndex',
      path: ['endIndex'],
    }),
    execute: async (args, { log }) => {
      const docs = await getDocsClient();
      log.info(
        `Updating section style in doc ${args.documentId} for range ${args.startIndex}-${args.endIndex}${args.tabId ? ` (tab: ${args.tabId})` : ''}`
      );
      try {
        if (args.tabId) {
          const docInfo = await docs.documents.get({
            documentId: args.documentId,
            includeTabsContent: true,
            fields: 'tabs(tabProperties,documentTab(body))',
          });
          const targetTab = GDocsHelpers.findTabById(docInfo.data, args.tabId);
          if (!targetTab) {
            throw new UserError(`Tab with ID "${args.tabId}" not found in document.`);
          }
          if (!targetTab.documentTab) {
            throw new UserError(
              `Tab "${args.tabId}" does not have content (may not be a document tab).`
            );
          }
        }

        const built = buildUpdateSectionStyleRequest({
          startIndex: args.startIndex,
          endIndex: args.endIndex,
          flipPageOrientation: args.flipPageOrientation,
          sectionType: args.sectionType,
          marginTop: args.marginTop,
          marginBottom: args.marginBottom,
          marginLeft: args.marginLeft,
          marginRight: args.marginRight,
          pageNumberStart: args.pageNumberStart,
          tabId: args.tabId,
        });

        if (!built) {
          throw new UserError(
            'No section style options were provided. Set at least one of: flipPageOrientation, sectionType, marginTop, marginBottom, marginLeft, marginRight, pageNumberStart.'
          );
        }

        await GDocsHelpers.executeBatchUpdate(docs, args.documentId, [built.request]);
        return `Successfully updated section style (${built.fields.join(', ')}) for range ${args.startIndex}-${args.endIndex}${args.tabId ? ` in tab ${args.tabId}` : ''}.`;
      } catch (error: any) {
        log.error(
          `Error updating section style in doc ${args.documentId}: ${error.message || error}`
        );
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to update section style: ${error.message || 'Unknown error'}`);
      }
    },
  });
}

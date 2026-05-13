import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { docs_v1 } from 'googleapis';
import { getDocsClient } from '../../clients.js';
import { DocumentIdParameter } from '../../types.js';
import * as GDocsHelpers from '../../googleDocsApiHelpers.js';

export function buildInsertSectionBreakRequest(params: {
  index: number;
  sectionType: 'NEXT_PAGE' | 'CONTINUOUS';
  tabId?: string;
}): docs_v1.Schema$Request {
  const location: docs_v1.Schema$Location = { index: params.index };
  if (params.tabId) {
    location.tabId = params.tabId;
  }
  return {
    insertSectionBreak: {
      location,
      sectionType: params.sectionType,
    },
  };
}

export function register(server: FastMCP) {
  server.addTool({
    name: 'insertSectionBreak',
    description:
      'Inserts a section break at a character index in the document. A section break starts a new section whose style (page orientation, margins, columns, page numbering) can then be customized with updateSectionStyle. Use sectionType="NEXT_PAGE" when you want the new section to start on a fresh page (required for mixing portrait and landscape pages in a single document) and "CONTINUOUS" when the new section should begin inline without a page break.',
    parameters: DocumentIdParameter.extend({
      index: z
        .number()
        .int()
        .min(1)
        .describe(
          "1-based character index within the document body where the section break will be inserted. Use readDocument with format='json' to inspect indices."
        ),
      sectionType: z
        .enum(['NEXT_PAGE', 'CONTINUOUS'])
        .default('NEXT_PAGE')
        .describe(
          'The type of section break. NEXT_PAGE starts the new section on the next page (required to change page orientation). CONTINUOUS starts the new section inline without a page break. Defaults to NEXT_PAGE.'
        ),
      tabId: z
        .string()
        .optional()
        .describe(
          'The ID of the specific tab to insert into. Use listDocumentTabs to get tab IDs. If not specified, inserts into the first tab.'
        ),
    }),
    execute: async (args, { log }) => {
      const docs = await getDocsClient();
      log.info(
        `Inserting ${args.sectionType} section break in doc ${args.documentId} at index ${args.index}${args.tabId ? ` (tab: ${args.tabId})` : ''}`
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

        const request = buildInsertSectionBreakRequest({
          index: args.index,
          sectionType: args.sectionType,
          tabId: args.tabId,
        });
        await GDocsHelpers.executeBatchUpdate(docs, args.documentId, [request]);
        return `Successfully inserted ${args.sectionType} section break at index ${args.index}${args.tabId ? ` in tab ${args.tabId}` : ''}.`;
      } catch (error: any) {
        log.error(
          `Error inserting section break in doc ${args.documentId}: ${error.message || error}`
        );
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to insert section break: ${error.message || 'Unknown error'}`);
      }
    },
  });
}

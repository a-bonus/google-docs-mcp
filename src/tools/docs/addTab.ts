import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { getDocsClient } from '../../clients.js';
import { DocumentIdParameter } from '../../types.js';
import * as GDocsHelpers from '../../googleDocsApiHelpers.js';

export function register(server: FastMCP) {
  server.addTool({
    name: 'addTab',
    description:
      "Adds a new tab to a Google Docs document. Optionally set the tab title, position, parent tab (for nesting), and icon emoji. Returns the new tab's ID and properties.",
    parameters: DocumentIdParameter.extend({
      title: z
        .string()
        .optional()
        .describe(
          'The title for the new tab. If not specified, Google Docs assigns a default name.'
        ),
      parentTabId: z
        .string()
        .optional()
        .describe(
          'The ID of an existing tab to nest this new tab under as a child. Use listDocumentTabs to get tab IDs. If not specified, the tab is created at the root level.'
        ),
      index: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe(
          'The zero-based position among sibling tabs (within the same parent). If not specified, the tab is added at the end.'
        ),
      iconEmoji: z
        .string()
        .optional()
        .describe('An emoji to display as the tab icon (e.g., "📋").'),
    }),
    execute: async (args, { log }) => {
      const docs = await getDocsClient();

      log.info(`Adding new tab to doc ${args.documentId}`);

      try {
        // If parentTabId is provided, verify it exists
        if (args.parentTabId) {
          const docInfo = await docs.documents.get({
            documentId: args.documentId,
            includeTabsContent: true,
            fields: 'tabs(tabProperties,documentTab(body))',
          });
          const parentTab = GDocsHelpers.findTabById(docInfo.data, args.parentTabId);
          if (!parentTab) {
            throw new UserError(`Parent tab with ID "${args.parentTabId}" not found in document.`);
          }
        }

        const tabProperties: Record<string, unknown> = {};
        if (args.title !== undefined) tabProperties.title = args.title;
        if (args.parentTabId !== undefined) tabProperties.parentTabId = args.parentTabId;
        if (args.index !== undefined) tabProperties.index = args.index;
        if (args.iconEmoji !== undefined) tabProperties.iconEmoji = args.iconEmoji;

        const response = await docs.documents.batchUpdate({
          documentId: args.documentId,
          requestBody: {
            requests: [
              {
                addDocumentTab: {
                  tabProperties,
                },
              } as any,
            ],
          },
        });

        const newTabProps = (response.data.replies?.[0] as any)?.addDocumentTab?.tabProperties;

        if (newTabProps) {
          return JSON.stringify(
            {
              message: `Successfully added new tab "${newTabProps.title || '(untitled)'}"`,
              tabId: newTabProps.tabId,
              title: newTabProps.title,
              index: newTabProps.index,
              parentTabId: newTabProps.parentTabId,
              nestingLevel: newTabProps.nestingLevel,
            },
            null,
            2
          );
        }

        return 'Tab created successfully, but could not retrieve the new tab details.';
      } catch (error: any) {
        log.error(`Error adding tab to doc ${args.documentId}: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        if (error.code === 404) throw new UserError(`Document not found (ID: ${args.documentId}).`);
        if (error.code === 403)
          throw new UserError(`Permission denied for document (ID: ${args.documentId}).`);
        throw new UserError(`Failed to add tab: ${error.message || 'Unknown error'}`);
      }
    },
  });
}

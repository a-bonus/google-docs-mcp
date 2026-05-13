import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { docs_v1 } from 'googleapis';
import { getDocsClient } from '../../clients.js';
import { DocumentIdParameter } from '../../types.js';
import * as GDocsHelpers from '../../googleDocsApiHelpers.js';

export function register(server: FastMCP) {
  server.addTool({
    name: 'insertPerson',
    description:
      'Inserts a Google Docs person smart chip at a specific paragraph location using an email address.',
    parameters: DocumentIdParameter.extend({
      index: z
        .number()
        .int()
        .min(1)
        .describe(
          '1-based character index within an existing paragraph where the person chip should be inserted.'
        ),
      email: z.string().email().describe('Email address linked to the person smart chip.'),
      name: z
        .string()
        .optional()
        .describe('Optional display name hint when Google Docs resolves the person mention.'),
      tabId: z.string().optional().describe('Optional target tab ID.'),
    }),
    execute: async (args, { log }) => {
      const docs = await getDocsClient();
      log.info(
        `Inserting person chip into ${args.documentId} at index ${args.index}${args.tabId ? ` (tab: ${args.tabId})` : ''}`
      );

      try {
        if (args.tabId) {
          const docInfo = await docs.documents.get({
            documentId: args.documentId,
            includeTabsContent: true,
            fields: 'tabs(tabProperties,documentTab(body))',
          });
          const targetTab = GDocsHelpers.findTabById(docInfo.data, args.tabId);
          if (!targetTab) throw new UserError(`Tab with ID "${args.tabId}" not found in document.`);
          if (!targetTab.documentTab) {
            throw new UserError(
              `Tab "${args.tabId}" does not have content (may not be a document tab).`
            );
          }
        }

        const location: Record<string, unknown> = { index: args.index };
        if (args.tabId) location.tabId = args.tabId;

        const request: docs_v1.Schema$Request = {
          insertPerson: {
            location: location as docs_v1.Schema$Location,
            personProperties: {
              email: args.email,
              name: args.name,
            },
          },
        };

        await GDocsHelpers.executeBatchUpdate(docs, args.documentId, [request]);
        return `Successfully inserted a person chip at index ${args.index}${args.tabId ? ` in tab ${args.tabId}` : ''}.`;
      } catch (error: any) {
        log.error(
          `Error inserting person chip into doc ${args.documentId}: ${error.message || error}`
        );
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to insert person chip: ${error.message || 'Unknown error'}`);
      }
    },
  });
}

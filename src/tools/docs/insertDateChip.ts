import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { docs_v1 } from 'googleapis';
import { getDocsClient } from '../../clients.js';
import { DocumentIdParameter } from '../../types.js';
import * as GDocsHelpers from '../../googleDocsApiHelpers.js';

const DateFormatSchema = z.enum([
  'DATE_FORMAT_UNSPECIFIED',
  'DATE_FORMAT_MONTH_DAY_ABBREVIATED',
  'DATE_FORMAT_MONTH_DAY_FULL',
  'DATE_FORMAT_MONTH_DAY_YEAR_ABBREVIATED',
  'DATE_FORMAT_ISO8601',
]);

const TimeFormatSchema = z.enum([
  'TIME_FORMAT_UNSPECIFIED',
  'TIME_FORMAT_DISABLED',
  'TIME_FORMAT_HOUR_MINUTE',
  'TIME_FORMAT_HOUR_MINUTE_TIMEZONE',
]);

function toGoogleTimestamp(input: string): string {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    throw new UserError(`Invalid date/time value: "${input}"`);
  }
  return date.toISOString();
}

export function register(server: FastMCP) {
  server.addTool({
    name: 'insertDateChip',
    description:
      'Inserts a Google Docs date smart chip at a specific paragraph location. This creates a real date element, not plain text.',
    parameters: DocumentIdParameter.extend({
      index: z
        .number()
        .int()
        .min(1)
        .describe(
          '1-based character index within an existing paragraph where the date chip should be inserted.'
        ),
      date: z
        .string()
        .min(1)
        .describe(
          'Date or date-time input parseable by JavaScript Date, e.g. "2026-05-07T15:30:00+09:00".'
        ),
      timeZoneId: z
        .string()
        .optional()
        .describe('Optional CLDR/IANA time zone, e.g. "Asia/Tokyo".'),
      locale: z.string().optional().describe('Optional locale, e.g. "ja" or "en".'),
      dateFormat: DateFormatSchema.optional().describe('How the date portion should be displayed.'),
      timeFormat: TimeFormatSchema.optional().describe('How the time portion should be displayed.'),
      tabId: z.string().optional().describe('Optional target tab ID.'),
    }),
    execute: async (args, { log }) => {
      const docs = await getDocsClient();
      log.info(
        `Inserting date chip into ${args.documentId} at index ${args.index}${args.tabId ? ` (tab: ${args.tabId})` : ''}`
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
          insertDate: {
            location: location as docs_v1.Schema$Location,
            dateElementProperties: {
              timestamp: toGoogleTimestamp(args.date),
              timeZoneId: args.timeZoneId,
              locale: args.locale,
              dateFormat: args.dateFormat,
              timeFormat: args.timeFormat,
            },
          },
        };

        await GDocsHelpers.executeBatchUpdate(docs, args.documentId, [request]);
        return `Successfully inserted a date chip at index ${args.index}${args.tabId ? ` in tab ${args.tabId}` : ''}.`;
      } catch (error: any) {
        log.error(
          `Error inserting date chip into doc ${args.documentId}: ${error.message || error}`
        );
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to insert date chip: ${error.message || 'Unknown error'}`);
      }
    },
  });
}

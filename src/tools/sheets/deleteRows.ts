import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { getSheetsClient } from '../../clients.js';
import * as SheetsHelpers from '../../googleSheetsApiHelpers.js';

export function register(server: FastMCP) {
  server.addTool({
    name: 'deleteRows',
    description:
      'Deletes a range of rows from a sheet, shifting the rows below up (like "Delete rows" in the Sheets UI). Unlike clearRange, the rows themselves are removed, including their formatting. This cannot be undone through the API — read the range first if unsure.',
    parameters: z
      .object({
        spreadsheetId: z
          .string()
          .describe(
            'The spreadsheet ID — the long string between /d/ and /edit in a Google Sheets URL.'
          ),
        sheetName: z
          .string()
          .optional()
          .describe('Name of the sheet/tab. Defaults to the first sheet if not provided.'),
        startRow: z.number().int().min(1).describe('1-based first row to delete (inclusive).'),
        endRow: z.number().int().min(1).describe('1-based last row to delete (inclusive).'),
      })
      .refine((d) => d.endRow >= d.startRow, {
        message: 'endRow must be greater than or equal to startRow.',
      }),
    execute: async (args, { log }) => {
      const sheets = await getSheetsClient();
      log.info(
        `Deleting rows ${args.startRow}–${args.endRow} in spreadsheet ${args.spreadsheetId}`
      );

      try {
        const sheetId = await SheetsHelpers.resolveSheetId(
          sheets,
          args.spreadsheetId,
          args.sheetName
        );

        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: args.spreadsheetId,
          requestBody: {
            requests: [
              {
                deleteDimension: {
                  range: {
                    sheetId,
                    dimension: 'ROWS',
                    startIndex: args.startRow - 1, // 0-based, inclusive
                    endIndex: args.endRow, // 0-based, exclusive (= 1-based inclusive)
                  },
                },
              },
            ],
          },
        });

        const count = args.endRow - args.startRow + 1;
        return `Successfully deleted ${count} row(s) (${args.startRow}–${args.endRow}). Rows below moved up by ${count}.`;
      } catch (error: any) {
        log.error(`Error deleting rows: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to delete rows: ${error.message || 'Unknown error'}`);
      }
    },
  });
}

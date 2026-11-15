import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { getSheetsClient } from '../../clients.js';
import * as SheetsHelpers from '../../googleSheetsApiHelpers.js';

export function register(server: FastMCP) {
  server.addTool({
    name: 'insertRows',
    description:
      'Inserts empty rows into a sheet, shifting existing rows down (like "Insert rows above" in the Sheets UI). Formulas and references to shifted cells are adjusted by Google Sheets automatically. Use this instead of rewriting a block of data when new rows are needed in the middle of a sheet.',
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
        startRow: z
          .number()
          .int()
          .min(1)
          .describe(
            '1-based row number where the first new row will be. The row currently at this position and everything below it moves down.'
          ),
        count: z
          .number()
          .int()
          .min(1)
          .default(1)
          .describe('Number of rows to insert. Defaults to 1.'),
        inheritFromBefore: z
          .boolean()
          .optional()
          .describe(
            'If true, new rows copy formatting from the row above; if false, from the row below. Defaults to true, or false when startRow is 1 (there is no row above).'
          ),
      })
      .refine((d) => !(d.startRow === 1 && d.inheritFromBefore === true), {
        message: 'inheritFromBefore cannot be true when startRow is 1 (there is no row above).',
      }),
    execute: async (args, { log }) => {
      const sheets = await getSheetsClient();
      log.info(
        `Inserting ${args.count} row(s) at row ${args.startRow} in spreadsheet ${args.spreadsheetId}`
      );

      try {
        const sheetId = await SheetsHelpers.resolveSheetId(
          sheets,
          args.spreadsheetId,
          args.sheetName
        );

        const inheritFromBefore = args.inheritFromBefore ?? args.startRow > 1;

        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: args.spreadsheetId,
          requestBody: {
            requests: [
              {
                insertDimension: {
                  range: {
                    sheetId,
                    dimension: 'ROWS',
                    startIndex: args.startRow - 1, // 0-based, inclusive
                    endIndex: args.startRow - 1 + args.count, // 0-based, exclusive
                  },
                  inheritFromBefore,
                },
              },
            ],
          },
        });

        const lastRow = args.startRow + args.count - 1;
        return `Successfully inserted ${args.count} row(s) as rows ${args.startRow}–${lastRow}. Rows previously at ${args.startRow} and below moved down by ${args.count}.`;
      } catch (error: any) {
        log.error(`Error inserting rows: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to insert rows: ${error.message || 'Unknown error'}`);
      }
    },
  });
}

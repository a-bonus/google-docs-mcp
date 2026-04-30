import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { getSheetsClient } from '../../clients.js';
import * as SheetsHelpers from '../../googleSheetsApiHelpers.js';

export function register(server: FastMCP) {
  server.addTool({
    name: 'extractSheetHyperlink',
    description:
      'Reads a single Google Sheets cell and returns its resolved hyperlink target along with the displayed text and source formula when available.',
    parameters: z.object({
      spreadsheetId: z
        .string()
        .describe(
          'The spreadsheet ID — the long string between /d/ and /edit in a Google Sheets URL.'
        ),
      cell: z
        .string()
        .describe('Single-cell A1 reference to inspect (e.g., "Sheet1!B2" or "B2").'),
    }),
    execute: async (args, { log }) => {
      const sheets = await getSheetsClient();
      log.info(`Extracting hyperlink from ${args.cell} in spreadsheet ${args.spreadsheetId}`);

      try {
        const hyperlink = await SheetsHelpers.readCellHyperlink(
          sheets,
          args.spreadsheetId,
          args.cell
        );

        return JSON.stringify(
          {
            spreadsheetId: args.spreadsheetId,
            requestedCell: args.cell,
            ...hyperlink,
          },
          null,
          2
        );
      } catch (error: any) {
        log.error(
          `Error extracting hyperlink from spreadsheet ${args.spreadsheetId}: ${error.message || error}`
        );
        if (error instanceof UserError) throw error;
        throw new UserError(
          `Failed to extract sheet hyperlink: ${error.message || 'Unknown error'}`
        );
      }
    },
  });
}

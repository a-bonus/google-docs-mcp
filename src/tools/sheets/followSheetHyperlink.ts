import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { getSheetsClient } from '../../clients.js';
import * as SheetsHelpers from '../../googleSheetsApiHelpers.js';

const DEFAULT_TIMEOUT_MS = 10000;
const RESPONSE_SNIPPET_LIMIT = 500;

function normalizeSnippet(rawText: string): string | null {
  const compact = rawText.replace(/\s+/g, ' ').trim();
  if (!compact) return null;
  return compact.slice(0, RESPONSE_SNIPPET_LIMIT);
}

function canReadResponseBody(contentType: string | null): boolean {
  if (!contentType) return true;
  return /(text\/|application\/json|application\/xml|application\/x-www-form-urlencoded)/i.test(
    contentType
  );
}

export function register(server: FastMCP) {
  server.addTool({
    name: 'followSheetHyperlink',
    description:
      'Reads a single Google Sheets cell, resolves its hyperlink, and performs an HTTP GET request to that URL. Use this to trigger link-backed processes without opening a browser.',
    parameters: z.object({
      spreadsheetId: z
        .string()
        .describe(
          'The spreadsheet ID — the long string between /d/ and /edit in a Google Sheets URL.'
        ),
      cell: z
        .string()
        .describe('Single-cell A1 reference to follow (e.g., "Sheet1!B2" or "B2").'),
    }),
    execute: async (args, { log }) => {
      const sheets = await getSheetsClient();
      log.info(`Following hyperlink from ${args.cell} in spreadsheet ${args.spreadsheetId}`);

      try {
        const hyperlink = await SheetsHelpers.readCellHyperlink(
          sheets,
          args.spreadsheetId,
          args.cell
        );
        const url = new URL(hyperlink.url);

        if (!['http:', 'https:'].includes(url.protocol)) {
          throw new UserError(
            `Unsupported hyperlink protocol "${url.protocol}". Only http and https are supported.`
          );
        }

        const response = await fetch(url, {
          method: 'GET',
          redirect: 'follow',
          signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
        });

        const contentType = response.headers.get('content-type');
        const responseSnippet = canReadResponseBody(contentType)
          ? normalizeSnippet(await response.text())
          : null;

        return JSON.stringify(
          {
            success: response.ok,
            spreadsheetId: args.spreadsheetId,
            requestedCell: args.cell,
            ...hyperlink,
            resolvedUrl: url.toString(),
            httpStatus: response.status,
            statusText: response.statusText,
            finalUrl: response.url,
            contentType,
            responseSnippet,
          },
          null,
          2
        );
      } catch (error: any) {
        log.error(
          `Error following hyperlink from spreadsheet ${args.spreadsheetId}: ${error.message || error}`
        );
        if (error instanceof UserError) throw error;
        if (error?.name === 'TimeoutError') {
          throw new UserError(`Request timed out after ${DEFAULT_TIMEOUT_MS}ms.`);
        }
        throw new UserError(`Failed to follow sheet hyperlink: ${error.message || 'Unknown error'}`);
      }
    },
  });
}

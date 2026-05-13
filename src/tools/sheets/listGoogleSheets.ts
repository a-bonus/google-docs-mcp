import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { getDriveClient } from '../../clients.js';
import { escapeDriveQuery } from '../../driveQueryUtils.js';

export function register(server: FastMCP) {
  server.addTool({
    name: 'listSpreadsheets',
    description: 'Lists spreadsheets in your Drive, optionally filtered by name or content.',
    parameters: z.object({
      maxResults: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .default(20)
        .describe('Maximum number of spreadsheets to return (1-100).'),
      query: z
        .string()
        .optional()
        .describe('Search query to filter spreadsheets by name or content.'),
      orderBy: z
        .enum(['name', 'modifiedTime', 'createdTime'])
        .optional()
        .default('modifiedTime')
        .describe('Sort order for results.'),
    }),
    execute: async (args, { log }) => {
      const drive = await getDriveClient();
      log.info(
        `Listing Google Sheets. Query: ${args.query || 'none'}, Max: ${args.maxResults}, Order: ${args.orderBy}`
      );

      try {
        // Build the query string for Google Drive API
        let queryString = "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false";
        if (args.query) {
          const escapedQuery = escapeDriveQuery(args.query);
          queryString += ` and (name contains '${escapedQuery}' or fullText contains '${escapedQuery}')`;
        }

        const response = await drive.files.list({
          q: queryString,
          pageSize: args.maxResults,
          orderBy: args.orderBy === 'name' ? 'name' : args.orderBy,
          fields:
            'files(id,name,modifiedTime,createdTime,size,webViewLink,owners(displayName,emailAddress))',
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
        });

        const files = response.data.files || [];

        const spreadsheets = files.map((file) => ({
          id: file.id,
          name: file.name,
          modifiedTime: file.modifiedTime,
          owner: file.owners?.[0]?.displayName || null,
          url: file.webViewLink,
        }));
        return JSON.stringify({ spreadsheets }, null, 2);
      } catch (error: any) {
        log.error(`Error listing Google Sheets: ${error.message || error}`);
        if (error.code === 403)
          throw new UserError(
            'Permission denied. Make sure you have granted Google Drive access to the application.'
          );
        throw new UserError(`Failed to list spreadsheets: ${error.message || 'Unknown error'}`);
      }
    },
  });
}

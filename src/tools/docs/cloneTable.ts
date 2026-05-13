import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { docs_v1 } from 'googleapis';
import { getDocsClient } from '../../clients.js';
import { DocumentIdParameter } from '../../types.js';
import * as GDocsHelpers from '../../googleDocsApiHelpers.js';
import { buildInsertTableWithDataRequests } from './insertTableWithData.js';
import { extractDocumentTables, extractTableSnapshot } from './structureHelpers.js';

const CLONE_TABLE_SOURCE_FIELDS =
  'body(content(startIndex,endIndex,table(rows,columns,tableStyle(tableColumnProperties(width,widthType)),tableRows(startIndex,endIndex,tableRowStyle(minRowHeight,preventOverflow,tableHeader),tableCells(startIndex,endIndex,tableCellStyle(backgroundColor,borderTop(color,width,dashStyle),borderBottom(color,width,dashStyle),borderLeft(color,width,dashStyle),borderRight(color,width,dashStyle),contentAlignment,paddingTop,paddingBottom,paddingLeft,paddingRight,rowSpan,columnSpan),content(paragraph(elements(startIndex,endIndex,textRun(content,textStyle(bold))))))))),tabs(tabProperties(tabId,title),documentTab(body(content(startIndex,endIndex,table(rows,columns,tableStyle(tableColumnProperties(width,widthType)),tableRows(startIndex,endIndex,tableRowStyle(minRowHeight,preventOverflow,tableHeader),tableCells(startIndex,endIndex,tableCellStyle(backgroundColor,borderTop(color,width,dashStyle),borderBottom(color,width,dashStyle),borderLeft(color,width,dashStyle),borderRight(color,width,dashStyle),contentAlignment,paddingTop,paddingBottom,paddingLeft,paddingRight,rowSpan,columnSpan),content(paragraph(elements(startIndex,endIndex,textRun(content,textStyle(bold))))))))))))';

const CloneTableParameters = DocumentIdParameter.extend({
  sourceDocumentId: z.string().min(1).describe('Document ID containing the source table template.'),
  sourceTableId: z.string().min(1).describe('Source MCP table ID from listDocumentTables.'),
  index: z
    .number()
    .int()
    .min(1)
    .describe(
      '1-based character index in the target document where the cloned table should be inserted.'
    ),
  sourceTabId: z.string().optional().describe('Optional tab ID for the source document table.'),
  targetTabId: z
    .string()
    .optional()
    .describe('Optional tab ID for the target document insertion point.'),
  copyColumnWidths: z
    .boolean()
    .optional()
    .default(true)
    .describe('Copy fixed column widths from the source table.'),
  copyRowStyles: z
    .boolean()
    .optional()
    .default(true)
    .describe('Copy row min height and overflow settings from the source table.'),
  copyCellStyles: z
    .boolean()
    .optional()
    .default(true)
    .describe('Copy cell-level formatting such as background, padding, alignment, and borders.'),
  copyPinnedHeaderRows: z
    .boolean()
    .optional()
    .default(true)
    .describe('Copy pinned header rows from the source table when present.'),
  copyHeaderBold: z
    .boolean()
    .optional()
    .default(true)
    .describe('Apply bold text to cloned cells whose source cell text was bold.'),
});

export function register(server: FastMCP) {
  server.addTool({
    name: 'cloneTable',
    description:
      'Clones a source Google Docs table into a target document, preserving text, column widths, row styles, cell styles, and pinned header rows where supported.',
    parameters: CloneTableParameters,
    execute: async (args, { log }) => {
      const docs = await getDocsClient();
      log.info(
        `Cloning table ${args.sourceTableId} from ${args.sourceDocumentId} into ${args.documentId} at index ${args.index}`
      );

      try {
        const sourceRes = await docs.documents.get({
          documentId: args.sourceDocumentId,
          includeTabsContent: true,
          fields: CLONE_TABLE_SOURCE_FIELDS,
        });

        const snapshot = extractTableSnapshot(sourceRes.data, args.sourceTableId, args.sourceTabId);
        if (!snapshot) {
          throw new UserError(
            `Source table "${args.sourceTableId}" was not found in source document ${args.sourceDocumentId}.`
          );
        }
        if (snapshot.rowCount === 0 || snapshot.columnCount === 0) {
          throw new UserError(
            `Source table "${args.sourceTableId}" is empty and cannot be cloned.`
          );
        }

        if (args.targetTabId) {
          const targetInfo = await docs.documents.get({
            documentId: args.documentId,
            includeTabsContent: true,
            fields: 'tabs(tabProperties,documentTab(body))',
          });
          const targetTab = GDocsHelpers.findTabById(targetInfo.data, args.targetTabId);
          if (!targetTab)
            throw new UserError(`Target tab "${args.targetTabId}" not found in document.`);
          if (!targetTab.documentTab) {
            throw new UserError(`Target tab "${args.targetTabId}" does not have document content.`);
          }
        }

        const insertRequests = buildInsertTableWithDataRequests(
          snapshot.data,
          args.index,
          false,
          args.targetTabId
        );
        await GDocsHelpers.executeBatchUpdateWithSplitting(
          docs,
          args.documentId,
          insertRequests,
          log
        );

        const targetRes = await docs.documents.get({
          documentId: args.documentId,
          includeTabsContent: true,
          fields:
            'body(content(startIndex,endIndex,table(rows,columns,tableRows(tableCells(startIndex,endIndex,content(paragraph(elements(startIndex,endIndex,textRun(content))))))))),tabs(tabProperties(tabId,title),documentTab(body(content(startIndex,endIndex,table(rows,columns,tableRows(tableCells(startIndex,endIndex,content(paragraph(elements(startIndex,endIndex,textRun(content)))))))))))',
        });

        const targetTable = extractDocumentTables(targetRes.data, args.targetTabId)
          .filter(
            (table) =>
              table.startIndex != null &&
              table.startIndex >= args.index &&
              table.rowCount === snapshot.rowCount &&
              table.columnCount === snapshot.columnCount
          )
          .sort(
            (a, b) =>
              (a.startIndex ?? Number.MAX_SAFE_INTEGER) - (b.startIndex ?? Number.MAX_SAFE_INTEGER)
          )[0];
        if (!targetTable || targetTable.startIndex == null) {
          throw new UserError(
            'Cloned target table was inserted, but could not be re-located safely for style copying.'
          );
        }

        const styleRequests: docs_v1.Schema$Request[] = [];

        if (args.copyColumnWidths) {
          for (const columnStyle of snapshot.columnStyles) {
            if (columnStyle.widthType !== 'FIXED_WIDTH' || !columnStyle.widthPt) continue;
            styleRequests.push(
              GDocsHelpers.buildTableColumnWidthRequest(
                targetTable.startIndex,
                [columnStyle.columnIndex],
                columnStyle.widthPt,
                args.targetTabId
              )
            );
          }
        }

        if (args.copyRowStyles) {
          for (const rowStyle of snapshot.rowStyles) {
            const request = GDocsHelpers.buildTableRowStyleRequest(
              targetTable.startIndex,
              [rowStyle.rowIndex],
              rowStyle.minRowHeightPt,
              rowStyle.preventOverflow,
              args.targetTabId
            );
            if (request) styleRequests.push(request);
          }
        }

        if (args.copyPinnedHeaderRows && snapshot.pinnedHeaderRowsCount > 0) {
          styleRequests.push(
            GDocsHelpers.buildPinTableHeaderRowsRequest(
              targetTable.startIndex,
              snapshot.pinnedHeaderRowsCount,
              args.targetTabId
            )
          );
        }

        if (args.copyCellStyles) {
          for (const cellStyle of snapshot.cellStyles) {
            const requestInfo = GDocsHelpers.buildTableCellStyleRequest(
              targetTable.startIndex,
              cellStyle.rowIndex,
              cellStyle.columnIndex,
              {
                backgroundColor: cellStyle.backgroundColor,
                contentAlignment: cellStyle.contentAlignment ?? undefined,
                paddingTopPt: cellStyle.paddingTopPt,
                paddingBottomPt: cellStyle.paddingBottomPt,
                paddingLeftPt: cellStyle.paddingLeftPt,
                paddingRightPt: cellStyle.paddingRightPt,
                borderTop: cellStyle.borderTop,
                borderBottom: cellStyle.borderBottom,
                borderLeft: cellStyle.borderLeft,
                borderRight: cellStyle.borderRight,
              },
              args.targetTabId
            );
            if (requestInfo) styleRequests.push(requestInfo.request);
          }
        }

        if (args.copyHeaderBold) {
          for (const cellStyle of snapshot.cellStyles) {
            if (!cellStyle.hasBoldText) continue;
            const targetCell = targetTable.cells.find(
              (cell) =>
                cell.rowIndex === cellStyle.rowIndex && cell.columnIndex === cellStyle.columnIndex
            );
            if (!targetCell?.contentStartIndex) continue;

            const targetText = snapshot.data[cellStyle.rowIndex]?.[cellStyle.columnIndex] ?? '';
            if (!targetText) continue;

            const requestInfo = GDocsHelpers.buildUpdateTextStyleRequest(
              targetCell.contentStartIndex,
              targetCell.contentStartIndex + targetText.length,
              { bold: true },
              args.targetTabId
            );
            if (requestInfo) styleRequests.push(requestInfo.request);
          }
        }

        if (styleRequests.length > 0) {
          await GDocsHelpers.executeBatchUpdateWithSplitting(
            docs,
            args.documentId,
            styleRequests,
            log
          );
        }

        return `Successfully cloned ${args.sourceTableId} into ${args.documentId} at index ${args.index}.`;
      } catch (error: any) {
        log.error(
          `Error cloning table ${args.sourceTableId} from ${args.sourceDocumentId}: ${error.message || error}`
        );
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to clone table: ${error.message || 'Unknown error'}`);
      }
    },
  });
}

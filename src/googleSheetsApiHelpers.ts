// src/googleSheetsApiHelpers.ts
import { google, sheets_v4 } from 'googleapis';
import { UserError } from 'fastmcp';

type Sheets = sheets_v4.Sheets; // Alias for convenience

export interface ExtractedSheetHyperlink {
  cell: string;
  sheetName: string | null;
  formattedValue: string | null;
  formula: string | null;
  url: string;
  linkSource: 'cellHyperlink' | 'cellFormat' | 'textFormatRun' | 'formula';
}

// --- Core Helper Functions ---

/**
 * Converts A1 notation to row/column indices (0-based)
 * Example: "A1" -> {row: 0, col: 0}, "B2" -> {row: 1, col: 1}
 */
export function a1ToRowCol(a1: string): { row: number; col: number } {
  const match = a1.match(/^([A-Z]+)(\d+)$/i);
  if (!match) {
    throw new UserError(`Invalid A1 notation: ${a1}. Expected format like "A1" or "B2"`);
  }

  const colStr = match[1].toUpperCase();
  const row = parseInt(match[2], 10) - 1; // Convert to 0-based

  let col = 0;
  for (let i = 0; i < colStr.length; i++) {
    col = col * 26 + (colStr.charCodeAt(i) - 64);
  }
  col -= 1; // Convert to 0-based

  return { row, col };
}

/**
 * Converts row/column indices (0-based) to A1 notation
 * Example: {row: 0, col: 0} -> "A1", {row: 1, col: 1} -> "B2"
 */
export function rowColToA1(row: number, col: number): string {
  if (row < 0 || col < 0) {
    throw new UserError(
      `Row and column indices must be non-negative. Got row: ${row}, col: ${col}`
    );
  }

  let colStr = '';
  let colNum = col + 1; // Convert to 1-based for calculation
  while (colNum > 0) {
    colNum -= 1;
    colStr = String.fromCharCode(65 + (colNum % 26)) + colStr;
    colNum = Math.floor(colNum / 26);
  }

  return `${colStr}${row + 1}`;
}

/**
 * Validates and normalizes a range string
 * Examples: "A1" -> "Sheet1!A1", "A1:B2" -> "Sheet1!A1:B2"
 */
export function normalizeRange(range: string, sheetName?: string): string {
  // If range already contains '!', assume it's already normalized
  if (range.includes('!')) {
    return range;
  }

  // If sheetName is provided, prepend it
  if (sheetName) {
    return `${sheetName}!${range}`;
  }

  // Default to Sheet1 if no sheet name provided
  return `Sheet1!${range}`;
}

/**
 * Reads values from a spreadsheet range
 */
export async function readRange(
  sheets: Sheets,
  spreadsheetId: string,
  range: string,
  valueRenderOption: 'FORMATTED_VALUE' | 'UNFORMATTED_VALUE' | 'FORMULA' = 'FORMATTED_VALUE'
): Promise<sheets_v4.Schema$ValueRange> {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
      valueRenderOption,
    });
    return response.data;
  } catch (error: any) {
    if (error.code === 404) {
      throw new UserError(`Spreadsheet not found (ID: ${spreadsheetId}). Check the ID.`);
    }
    if (error.code === 403) {
      throw new UserError(
        `Permission denied for spreadsheet (ID: ${spreadsheetId}). Ensure you have read access.`
      );
    }
    throw new UserError(`Failed to read range: ${error.message || 'Unknown error'}`);
  }
}

/**
 * Reads a single cell hyperlink from grid data, including formula fallback.
 */
function quoteSheetName(sheetName: string): string {
  return /[\s'!]/.test(sheetName) ? `'${sheetName.replace(/'/g, "''")}'` : sheetName;
}

function extractFormulaHyperlink(formulaValue: string | null | undefined): string | null {
  if (!formulaValue) return null;

  const match = formulaValue.match(
    /^\s*=\s*HYPERLINK\s*\(\s*"([^"]+)"\s*(?:,|\))/
  );
  return match?.[1] ?? null;
}

function extractHyperlinkFromCellData(
  cellData: sheets_v4.Schema$CellData | undefined,
  cellRef: string,
  sheetName: string | null
): ExtractedSheetHyperlink {
  const formula = cellData?.userEnteredValue?.formulaValue ?? null;
  const formattedValue = cellData?.formattedValue ?? null;

  if (cellData?.hyperlink) {
    return {
      cell: cellRef,
      sheetName,
      formattedValue,
      formula,
      url: cellData.hyperlink,
      linkSource: 'cellHyperlink',
    };
  }

  const cellFormatLink = cellData?.userEnteredFormat?.textFormat?.link?.uri;
  if (cellFormatLink) {
    return {
      cell: cellRef,
      sheetName,
      formattedValue,
      formula,
      url: cellFormatLink,
      linkSource: 'cellFormat',
    };
  }

  const runLinks = Array.from(
    new Set(
      (cellData?.textFormatRuns ?? [])
        .map((run) => run.format?.link?.uri ?? null)
        .filter((url): url is string => typeof url === 'string' && url.length > 0)
    )
  );

  if (runLinks.length > 1) {
    throw new UserError(
      `Cell ${sheetName ? `${sheetName}!` : ''}${cellRef} contains multiple hyperlinks.`
    );
  }

  if (runLinks.length === 1) {
    return {
      cell: cellRef,
      sheetName,
      formattedValue,
      formula,
      url: runLinks[0],
      linkSource: 'textFormatRun',
    };
  }

  const formulaLink = extractFormulaHyperlink(formula);
  if (formulaLink) {
    return {
      cell: cellRef,
      sheetName,
      formattedValue,
      formula,
      url: formulaLink,
      linkSource: 'formula',
    };
  }

  throw new UserError(`Cell ${sheetName ? `${sheetName}!` : ''}${cellRef} does not contain a hyperlink.`);
}

export async function readCellHyperlink(
  sheets: Sheets,
  spreadsheetId: string,
  cell: string
): Promise<ExtractedSheetHyperlink> {
  try {
    const { sheetName, a1Range } = parseRange(cell);
    a1ToRowCol(a1Range);

    const metadata = await getSpreadsheetMetadata(sheets, spreadsheetId);
    const targetSheet = sheetName
      ? metadata.sheets?.find((sheet) => sheet.properties?.title === sheetName)
      : metadata.sheets?.[0];

    const targetSheetName = targetSheet?.properties?.title ?? null;
    if (!targetSheetName) {
      throw new UserError('Spreadsheet has no sheets.');
    }

    const response = await sheets.spreadsheets.get({
      spreadsheetId,
      ranges: [`${quoteSheetName(targetSheetName)}!${a1Range}`],
      includeGridData: true,
      fields:
        'sheets.properties.title,sheets.data.rowData.values.formattedValue,sheets.data.rowData.values.hyperlink,sheets.data.rowData.values.textFormatRuns,sheets.data.rowData.values.userEnteredFormat.textFormat.link,sheets.data.rowData.values.userEnteredValue.formulaValue,sheets.data.startRow,sheets.data.startColumn',
    });

    const data = response.data.sheets?.[0]?.data?.[0];
    const cellData = data?.rowData?.[0]?.values?.[0];
    return extractHyperlinkFromCellData(cellData, a1Range, targetSheetName);
  } catch (error: any) {
    if (error.code === 404) {
      throw new UserError(`Spreadsheet not found (ID: ${spreadsheetId}). Check the ID.`);
    }
    if (error.code === 403) {
      throw new UserError(
        `Permission denied for spreadsheet (ID: ${spreadsheetId}). Ensure you have read access.`
      );
    }
    if (error instanceof UserError) throw error;
    throw new UserError(`Failed to read cell hyperlink: ${error.message || 'Unknown error'}`);
  }
}

/**
 * Writes values to a spreadsheet range
 */
export async function writeRange(
  sheets: Sheets,
  spreadsheetId: string,
  range: string,
  values: any[][],
  valueInputOption: 'RAW' | 'USER_ENTERED' = 'USER_ENTERED'
): Promise<sheets_v4.Schema$UpdateValuesResponse> {
  try {
    const response = await sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption,
      requestBody: {
        values,
      },
    });
    return response.data;
  } catch (error: any) {
    if (error.code === 404) {
      throw new UserError(`Spreadsheet not found (ID: ${spreadsheetId}). Check the ID.`);
    }
    if (error.code === 403) {
      throw new UserError(
        `Permission denied for spreadsheet (ID: ${spreadsheetId}). Ensure you have write access.`
      );
    }
    throw new UserError(`Failed to write range: ${error.message || 'Unknown error'}`);
  }
}

/**
 * Appends values to the end of a sheet
 */
export async function appendValues(
  sheets: Sheets,
  spreadsheetId: string,
  range: string,
  values: any[][],
  valueInputOption: 'RAW' | 'USER_ENTERED' = 'USER_ENTERED'
): Promise<sheets_v4.Schema$AppendValuesResponse> {
  try {
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range,
      valueInputOption,
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values,
      },
    });
    return response.data;
  } catch (error: any) {
    if (error.code === 404) {
      throw new UserError(`Spreadsheet not found (ID: ${spreadsheetId}). Check the ID.`);
    }
    if (error.code === 403) {
      throw new UserError(
        `Permission denied for spreadsheet (ID: ${spreadsheetId}). Ensure you have write access.`
      );
    }
    throw new UserError(`Failed to append values: ${error.message || 'Unknown error'}`);
  }
}

/**
 * Clears values from a range
 */
export async function clearRange(
  sheets: Sheets,
  spreadsheetId: string,
  range: string
): Promise<sheets_v4.Schema$ClearValuesResponse> {
  try {
    const response = await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range,
    });
    return response.data;
  } catch (error: any) {
    if (error.code === 404) {
      throw new UserError(`Spreadsheet not found (ID: ${spreadsheetId}). Check the ID.`);
    }
    if (error.code === 403) {
      throw new UserError(
        `Permission denied for spreadsheet (ID: ${spreadsheetId}). Ensure you have write access.`
      );
    }
    throw new UserError(`Failed to clear range: ${error.message || 'Unknown error'}`);
  }
}

/**
 * Gets spreadsheet metadata including sheet information
 */
export async function getSpreadsheetMetadata(
  sheets: Sheets,
  spreadsheetId: string
): Promise<sheets_v4.Schema$Spreadsheet> {
  try {
    const response = await sheets.spreadsheets.get({
      spreadsheetId,
      includeGridData: false,
    });
    return response.data;
  } catch (error: any) {
    if (error.code === 404) {
      throw new UserError(`Spreadsheet not found (ID: ${spreadsheetId}). Check the ID.`);
    }
    if (error.code === 403) {
      throw new UserError(
        `Permission denied for spreadsheet (ID: ${spreadsheetId}). Ensure you have read access.`
      );
    }
    throw new UserError(`Failed to get spreadsheet metadata: ${error.message || 'Unknown error'}`);
  }
}

/**
 * Creates a new sheet/tab in a spreadsheet
 */
export async function addSheet(
  sheets: Sheets,
  spreadsheetId: string,
  sheetTitle: string
): Promise<sheets_v4.Schema$BatchUpdateSpreadsheetResponse> {
  try {
    const response = await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title: sheetTitle,
              },
            },
          },
        ],
      },
    });
    return response.data;
  } catch (error: any) {
    if (error.code === 404) {
      throw new UserError(`Spreadsheet not found (ID: ${spreadsheetId}). Check the ID.`);
    }
    if (error.code === 403) {
      throw new UserError(
        `Permission denied for spreadsheet (ID: ${spreadsheetId}). Ensure you have write access.`
      );
    }
    throw new UserError(`Failed to add sheet: ${error.message || 'Unknown error'}`);
  }
}

/**
 * Parses A1 notation range to extract sheet name and cell range
 * Returns {sheetName, a1Range} where a1Range is just the cell part (e.g., "A1:B2")
 */
export function parseRange(range: string): { sheetName: string | null; a1Range: string } {
  const idx = range.indexOf('!');
  if (idx !== -1) {
    return {
      sheetName: range.slice(0, idx).replace(/^'|'$/g, ''),
      a1Range: range.slice(idx + 1),
    };
  }
  return {
    sheetName: null,
    a1Range: range,
  };
}

/**
 * Resolves a sheet name to a numeric sheet ID.
 * If sheetName is null/undefined, returns the first sheet's ID.
 */
export async function resolveSheetId(
  sheets: Sheets,
  spreadsheetId: string,
  sheetName?: string | null
): Promise<number> {
  const metadata = await getSpreadsheetMetadata(sheets, spreadsheetId);

  if (sheetName) {
    const sheet = metadata.sheets?.find((s) => s.properties?.title === sheetName);
    if (!sheet || sheet.properties?.sheetId === undefined || sheet.properties?.sheetId === null) {
      throw new UserError(`Sheet "${sheetName}" not found in spreadsheet.`);
    }
    return sheet.properties.sheetId;
  }

  const firstSheet = metadata.sheets?.[0];
  if (firstSheet?.properties?.sheetId === undefined || firstSheet?.properties?.sheetId === null) {
    throw new UserError('Spreadsheet has no sheets.');
  }
  return firstSheet.properties.sheetId;
}

/**
 * Converts column letters to a 0-based column index.
 * Example: "A" -> 0, "B" -> 1, "Z" -> 25, "AA" -> 26
 */
export function colLettersToIndex(col: string): number {
  let index = 0;
  const upper = col.toUpperCase();
  for (let i = 0; i < upper.length; i++) {
    index = index * 26 + (upper.charCodeAt(i) - 64);
  }
  return index - 1;
}

/**
 * Parses an A1-notation cell range string into a Google Sheets GridRange object.
 * Supports:
 *   - Standard: "A1", "A1:B2"
 *   - Whole rows: "1:1", "1:3"
 *   - Whole columns: "A:A", "A:C"
 * When a component is omitted (whole row/column), the corresponding
 * start/end index is left out of the GridRange, which the Sheets API
 * interprets as "unbounded" (i.e., the entire row or column).
 */
export function parseA1ToGridRange(a1Range: string, sheetId: number): sheets_v4.Schema$GridRange {
  // Whole-row pattern: "1:3" or "1"
  const rowOnlyMatch = a1Range.match(/^(\d+)(?::(\d+))?$/);
  if (rowOnlyMatch) {
    const startRow = parseInt(rowOnlyMatch[1], 10) - 1;
    const endRow = rowOnlyMatch[2] ? parseInt(rowOnlyMatch[2], 10) : startRow + 1;
    return {
      sheetId,
      startRowIndex: startRow,
      endRowIndex: endRow,
      // no column indices → entire row
    };
  }

  // Whole-column pattern: "A:C" or "A"
  const colOnlyMatch = a1Range.match(/^([A-Z]+)(?::([A-Z]+))?$/i);
  if (colOnlyMatch && !/\d/.test(a1Range)) {
    const startCol = colLettersToIndex(colOnlyMatch[1]);
    const endCol = colOnlyMatch[2] ? colLettersToIndex(colOnlyMatch[2]) + 1 : startCol + 1;
    return {
      sheetId,
      startColumnIndex: startCol,
      endColumnIndex: endCol,
      // no row indices → entire column
    };
  }

  // Standard A1 pattern: "A1" or "A1:B2"
  const standardMatch = a1Range.match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/i);
  if (!standardMatch) {
    throw new UserError(
      `Invalid range format: "${a1Range}". Expected "A1:B2", "1:1" (whole row), or "A:A" (whole column).`
    );
  }

  const startCol = colLettersToIndex(standardMatch[1]);
  const startRow = parseInt(standardMatch[2], 10) - 1;
  const endCol = standardMatch[3] ? colLettersToIndex(standardMatch[3]) + 1 : startCol + 1;
  const endRow = standardMatch[4] ? parseInt(standardMatch[4], 10) : startRow + 1;

  return {
    sheetId,
    startRowIndex: startRow,
    endRowIndex: endRow,
    startColumnIndex: startCol,
    endColumnIndex: endCol,
  };
}

/**
 * Formats cells in a range.
 * Supports standard A1 ranges ("A1:D1"), whole-row ("1:1"), and whole-column ("A:A") notation.
 */
export async function formatCells(
  sheets: Sheets,
  spreadsheetId: string,
  range: string,
  format: {
    backgroundColor?: { red: number; green: number; blue: number };
    textFormat?: {
      foregroundColor?: { red: number; green: number; blue: number };
      fontSize?: number;
      bold?: boolean;
      italic?: boolean;
    };
    horizontalAlignment?: 'LEFT' | 'CENTER' | 'RIGHT';
    verticalAlignment?: 'TOP' | 'MIDDLE' | 'BOTTOM';
    wrapStrategy?: 'OVERFLOW_CELL' | 'CLIP' | 'WRAP';
    numberFormat?: { type: string; pattern?: string };
  }
): Promise<sheets_v4.Schema$BatchUpdateSpreadsheetResponse> {
  try {
    // Parse the range to get sheet name and cell range
    const { sheetName, a1Range } = parseRange(range);
    const sheetId = await resolveSheetId(sheets, spreadsheetId, sheetName);

    // Parse A1 range to get row/column indices
    // Supports: "A1:B2" (standard), "1:3" (whole rows), "A:C" (whole columns)
    const gridRange = parseA1ToGridRange(a1Range, sheetId);

    const userEnteredFormat: sheets_v4.Schema$CellFormat = {};

    if (format.backgroundColor) {
      userEnteredFormat.backgroundColor = {
        red: format.backgroundColor.red,
        green: format.backgroundColor.green,
        blue: format.backgroundColor.blue,
        alpha: 1,
      };
    }

    if (format.textFormat) {
      userEnteredFormat.textFormat = {};
      if (format.textFormat.foregroundColor) {
        userEnteredFormat.textFormat.foregroundColor = {
          red: format.textFormat.foregroundColor.red,
          green: format.textFormat.foregroundColor.green,
          blue: format.textFormat.foregroundColor.blue,
          alpha: 1,
        };
      }
      if (format.textFormat.fontSize !== undefined) {
        userEnteredFormat.textFormat.fontSize = format.textFormat.fontSize;
      }
      if (format.textFormat.bold !== undefined) {
        userEnteredFormat.textFormat.bold = format.textFormat.bold;
      }
      if (format.textFormat.italic !== undefined) {
        userEnteredFormat.textFormat.italic = format.textFormat.italic;
      }
    }

    if (format.horizontalAlignment) {
      userEnteredFormat.horizontalAlignment = format.horizontalAlignment;
    }

    if (format.verticalAlignment) {
      userEnteredFormat.verticalAlignment = format.verticalAlignment;
    }

    if (format.wrapStrategy) {
      userEnteredFormat.wrapStrategy = format.wrapStrategy;
    }

    if (format.numberFormat) {
      userEnteredFormat.numberFormat = {
        type: format.numberFormat.type,
        pattern: format.numberFormat.pattern ?? '',
      };
    }

    const fields = [
      'backgroundColor',
      'textFormat',
      'horizontalAlignment',
      'verticalAlignment',
      'wrapStrategy',
      ...(format.numberFormat ? ['numberFormat'] : []),
    ].join(',');

    const response = await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            repeatCell: {
              range: gridRange,
              cell: {
                userEnteredFormat,
              },
              fields: `userEnteredFormat(${fields})`,
            },
          },
        ],
      },
    });

    return response.data;
  } catch (error: any) {
    if (error.code === 404) {
      throw new UserError(`Spreadsheet not found (ID: ${spreadsheetId}). Check the ID.`);
    }
    if (error.code === 403) {
      throw new UserError(
        `Permission denied for spreadsheet (ID: ${spreadsheetId}). Ensure you have write access.`
      );
    }
    if (error instanceof UserError) throw error;
    throw new UserError(`Failed to format cells: ${error.message || 'Unknown error'}`);
  }
}

/**
 * Freezes rows and/or columns in a sheet so they remain visible when scrolling.
 */
export async function freezeRowsAndColumns(
  sheets: Sheets,
  spreadsheetId: string,
  sheetName?: string | null,
  frozenRows?: number,
  frozenColumns?: number
): Promise<sheets_v4.Schema$BatchUpdateSpreadsheetResponse> {
  try {
    const sheetId = await resolveSheetId(sheets, spreadsheetId, sheetName);

    const gridProperties: sheets_v4.Schema$GridProperties = {};
    const fieldParts: string[] = [];

    if (frozenRows !== undefined) {
      gridProperties.frozenRowCount = frozenRows;
      fieldParts.push('gridProperties.frozenRowCount');
    }
    if (frozenColumns !== undefined) {
      gridProperties.frozenColumnCount = frozenColumns;
      fieldParts.push('gridProperties.frozenColumnCount');
    }

    const response = await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            updateSheetProperties: {
              properties: {
                sheetId,
                gridProperties,
              },
              fields: fieldParts.join(','),
            },
          },
        ],
      },
    });

    return response.data;
  } catch (error: any) {
    if (error.code === 404) {
      throw new UserError(`Spreadsheet not found (ID: ${spreadsheetId}). Check the ID.`);
    }
    if (error.code === 403) {
      throw new UserError(
        `Permission denied for spreadsheet (ID: ${spreadsheetId}). Ensure you have write access.`
      );
    }
    if (error instanceof UserError) throw error;
    throw new UserError(`Failed to freeze rows/columns: ${error.message || 'Unknown error'}`);
  }
}

/**
 * Sets or clears dropdown data validation on a range of cells.
 * When values are provided, creates a ONE_OF_LIST validation rule.
 * When values are omitted or empty, clears any existing validation from the range.
 */
export async function setDropdownValidation(
  sheets: Sheets,
  spreadsheetId: string,
  range: string,
  values?: string[],
  strict: boolean = true,
  inputMessage?: string
): Promise<sheets_v4.Schema$BatchUpdateSpreadsheetResponse> {
  try {
    const { sheetName, a1Range } = parseRange(range);
    const sheetId = await resolveSheetId(sheets, spreadsheetId, sheetName);
    const gridRange = parseA1ToGridRange(a1Range, sheetId);

    const rule =
      values && values.length > 0
        ? {
            condition: {
              type: 'ONE_OF_LIST' as const,
              values: values.map((v) => ({ userEnteredValue: v })),
            },
            showCustomUi: true,
            strict,
            inputMessage: inputMessage || null,
          }
        : undefined;

    const response = await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            setDataValidation: {
              range: gridRange,
              rule,
            },
          },
        ],
      },
    });

    return response.data;
  } catch (error: any) {
    if (error.code === 404) {
      throw new UserError(`Spreadsheet not found (ID: ${spreadsheetId}). Check the ID.`);
    }
    if (error.code === 403) {
      throw new UserError(
        `Permission denied for spreadsheet (ID: ${spreadsheetId}). Ensure you have write access.`
      );
    }
    if (error instanceof UserError) throw error;
    throw new UserError(`Failed to set dropdown validation: ${error.message || 'Unknown error'}`);
  }
}

/**
 * Sets the width (in pixels) of one or more columns.
 * Each entry may target a single column ("A") or a contiguous range ("A:C").
 */
export async function setColumnWidths(
  sheets: Sheets,
  spreadsheetId: string,
  sheetName: string | null | undefined,
  columnWidths: Array<{ column: string; width: number }>
): Promise<sheets_v4.Schema$BatchUpdateSpreadsheetResponse> {
  try {
    const sheetId = await resolveSheetId(sheets, spreadsheetId, sheetName);

    const requests: sheets_v4.Schema$Request[] = columnWidths.map(({ column, width }) => {
      const colonIdx = column.indexOf(':');
      let startIndex: number;
      let endIndex: number;

      if (colonIdx !== -1) {
        startIndex = colLettersToIndex(column.slice(0, colonIdx).trim());
        endIndex = colLettersToIndex(column.slice(colonIdx + 1).trim()) + 1;
      } else {
        startIndex = colLettersToIndex(column.trim());
        endIndex = startIndex + 1;
      }

      return {
        updateDimensionProperties: {
          range: {
            sheetId,
            dimension: 'COLUMNS',
            startIndex,
            endIndex,
          },
          properties: {
            pixelSize: width,
          },
          fields: 'pixelSize',
        },
      };
    });

    const response = await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests },
    });

    return response.data;
  } catch (error: any) {
    if (error.code === 404) {
      throw new UserError(`Spreadsheet not found (ID: ${spreadsheetId}). Check the ID.`);
    }
    if (error.code === 403) {
      throw new UserError(
        `Permission denied for spreadsheet (ID: ${spreadsheetId}). Ensure you have write access.`
      );
    }
    if (error instanceof UserError) throw error;
    throw new UserError(`Failed to set column widths: ${error.message || 'Unknown error'}`);
  }
}

/**
 * Helper to convert hex color to RGB (0-1 range)
 */
export function hexToRgb(hex: string): { red: number; green: number; blue: number } | null {
  if (!hex) return null;
  let hexClean = hex.startsWith('#') ? hex.slice(1) : hex;

  if (hexClean.length === 3) {
    hexClean = hexClean[0] + hexClean[0] + hexClean[1] + hexClean[1] + hexClean[2] + hexClean[2];
  }
  if (hexClean.length !== 6) return null;
  const bigint = parseInt(hexClean, 16);
  if (isNaN(bigint)) return null;

  return {
    red: ((bigint >> 16) & 255) / 255,
    green: ((bigint >> 8) & 255) / 255,
    blue: (bigint & 255) / 255,
  };
}

/**
 * Appends a BooleanRule conditional format rule to a spreadsheet.
 */
export async function addConditionalFormatRule(
  sheets: Sheets,
  spreadsheetId: string,
  ranges: sheets_v4.Schema$GridRange[],
  conditionType: string,
  conditionValues: Array<{ userEnteredValue: string }>,
  format: Record<string, unknown>
): Promise<void> {
  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            addConditionalFormatRule: {
              rule: {
                ranges,
                booleanRule: {
                  condition: {
                    type: conditionType,
                    values: conditionValues,
                  },
                  format,
                },
              },
              index: 0,
            },
          },
        ],
      },
    });
  } catch (error: any) {
    if (error.code === 404) {
      throw new UserError(`Spreadsheet not found (ID: ${spreadsheetId}). Check the ID.`);
    }
    if (error.code === 403) {
      throw new UserError(
        `Permission denied for spreadsheet (ID: ${spreadsheetId}). Ensure you have write access.`
      );
    }
    throw new UserError(
      `Failed to add conditional format rule: ${error.message || 'Unknown error'}`
    );
  }
}

// --- Table Helper Functions ---

/**
 * Resolves a table name or ID to a table object with sheet context.
 * Searches through all sheets in the spreadsheet.
 */
export async function resolveTableIdentifier(
  sheets: Sheets,
  spreadsheetId: string,
  tableIdentifier: string
): Promise<{
  table: sheets_v4.Schema$Table;
  sheetId: number;
  sheetName: string;
}> {
  const metadata = await getSpreadsheetMetadata(sheets, spreadsheetId);

  // Search through all sheets for the table
  for (const sheet of metadata.sheets || []) {
    // Check if sheetId exists (can be 0, which is valid for first sheet!)
    if (sheet.properties?.sheetId === null || sheet.properties?.sheetId === undefined) {
      continue;
    }

    const sheetName = sheet.properties.title || 'Unknown';
    const tables = sheet.tables || [];

    for (const table of tables) {
      if (!table) continue;

      // Match by tableId (string) or name (case-insensitive)
      const idMatch = table.tableId === tableIdentifier;
      const nameMatch = table.name
        ? table.name.toLowerCase() === tableIdentifier.toLowerCase()
        : false;

      if (idMatch || nameMatch) {
        if (sheet.properties.sheetId === null || sheet.properties.sheetId === undefined) {
          throw new UserError(`Sheet "${sheetName}" has invalid ID.`);
        }
        return {
          table,
          sheetId: sheet.properties.sheetId,
          sheetName,
        };
      }
    }
  }

  throw new UserError(
    `Table "${tableIdentifier}" not found in spreadsheet. Use listTables to see available tables.`
  );
}

/**
 * Lists all tables across all sheets in a spreadsheet.
 * Optionally filters by sheet name.
 */
export async function listAllTables(
  sheets: Sheets,
  spreadsheetId: string,
  sheetNameFilter?: string
): Promise<
  Array<{
    table: sheets_v4.Schema$Table;
    sheetName: string;
    sheetId: number;
  }>
> {
  const metadata = await getSpreadsheetMetadata(sheets, spreadsheetId);
  const result: Array<{
    table: sheets_v4.Schema$Table;
    sheetName: string;
    sheetId: number;
  }> = [];

  for (const sheet of metadata.sheets || []) {
    // Check if sheetId exists (can be 0, which is valid for first sheet!)
    if (sheet.properties?.sheetId === null || sheet.properties?.sheetId === undefined) {
      continue;
    }

    // Filter by sheet name if provided
    if (sheetNameFilter && sheet.properties.title !== sheetNameFilter) continue;

    const sheetName = sheet.properties.title || 'Unknown';
    const tables = sheet.tables || [];

    for (const table of tables) {
      if (table) {
        result.push({
          table,
          sheetName,
          sheetId: sheet.properties.sheetId,
        });
      }
    }
  }

  return result;
}

/**
 * Creates a new table with specified properties.
 */
export async function createTableHelper(
  sheets: Sheets,
  spreadsheetId: string,
  tableDefinition: {
    name: string;
    range: sheets_v4.Schema$GridRange;
    columnProperties?: sheets_v4.Schema$TableColumnProperties[];
  }
): Promise<sheets_v4.Schema$Table> {
  try {
    const response = await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            addTable: {
              table: {
                name: tableDefinition.name,
                range: tableDefinition.range,
                columnProperties: tableDefinition.columnProperties,
              },
            },
          },
        ],
      },
    });

    const reply = response.data.replies?.[0]?.addTable;
    if (!reply?.table) {
      throw new UserError('Failed to create table - no table returned in response.');
    }

    return reply.table;
  } catch (error: any) {
    if (error.code === 400) {
      throw new UserError(`Invalid table definition: ${error.message}`);
    }
    if (error.code === 403) {
      throw new UserError(`Permission denied. Ensure you have write access to this spreadsheet.`);
    }
    throw error;
  }
}

/**
 * Deletes a table by ID.
 */
export async function deleteTableHelper(
  sheets: Sheets,
  spreadsheetId: string,
  tableId: string
): Promise<void> {
  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            deleteTable: {
              tableId,
            },
          },
        ],
      },
    });
  } catch (error: any) {
    if (error.code === 404) {
      throw new UserError(`Table not found (ID: ${tableId}).`);
    }
    if (error.code === 403) {
      throw new UserError(`Permission denied. Ensure you have write access to this spreadsheet.`);
    }
    throw error;
  }
}

/**
 * Updates a table's range.
 */
export async function updateTableRangeHelper(
  sheets: Sheets,
  spreadsheetId: string,
  tableId: string,
  newRange: sheets_v4.Schema$GridRange
): Promise<sheets_v4.Schema$Table> {
  try {
    const response = await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            updateTable: {
              table: {
                tableId,
                range: newRange,
              },
              fields: 'range',
            },
          },
        ],
      },
    });

    // The Google Sheets API may not return the table object in the response
    // even though the update was successful. Fetch the updated table to return.
    const { table } = await resolveTableIdentifier(sheets, spreadsheetId, tableId);
    return table;
  } catch (error: any) {
    if (error.code === 404) {
      throw new UserError(`Table not found (ID: ${tableId}).`);
    }
    if (error.code === 400) {
      throw new UserError(`Invalid range: ${error.message}`);
    }
    if (error.code === 403) {
      throw new UserError(`Permission denied. Ensure you have write access to this spreadsheet.`);
    }
    throw error;
  }
}

/**
 * Appends rows to a table using table-aware insertion.
 * Gets the table's range and appends values after the last data row.
 */
export async function appendToTableHelper(
  sheets: Sheets,
  spreadsheetId: string,
  tableId: string,
  values: any[][]
): Promise<{ rowsAppended: number; updatedRange: string }> {
  try {
    // First, get the table to find its range
    const { table, sheetName } = await resolveTableIdentifier(sheets, spreadsheetId, tableId);

    if (!table.range) {
      throw new UserError('Table does not have a range defined.');
    }

    // Calculate the range to append to (start after the table's end row)
    const startRowIndex = table.range.endRowIndex || 0;
    const startColumnIndex = table.range.startColumnIndex || 0;
    const endColumnIndex = table.range.endColumnIndex || 0;

    const range = `${sheetName}!${rowColToA1(startRowIndex, startColumnIndex)}:${rowColToA1(
      startRowIndex + values.length - 1,
      endColumnIndex - 1
    )}`;

    // Append the values using the standard values.append API
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values,
      },
    });

    return {
      rowsAppended: values.length,
      updatedRange: response.data.updates?.updatedRange || range,
    };
  } catch (error: any) {
    if (error.code === 404) {
      throw new UserError(`Table or spreadsheet not found (ID: ${tableId}).`);
    }
    if (error.code === 400) {
      throw new UserError(`Invalid data: ${error.message}`);
    }
    if (error.code === 403) {
      throw new UserError(`Permission denied. Ensure you have write access to this spreadsheet.`);
    }
    throw error;
  }
}

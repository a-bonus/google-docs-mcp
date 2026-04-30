# Sheets

Tools for reading, writing, and managing Google Spreadsheets, including cell data operations, formatting, validation, sheet/tab management, and spreadsheet creation.

## Data

| Tool               | Description                                              |
| ------------------ | -------------------------------------------------------- |
| `readSpreadsheet`  | Reads data from a range in a spreadsheet                 |
| `extractSheetHyperlink` | Resolves the hyperlink target stored in a single cell |
| `followSheetHyperlink` | Resolves a single-cell hyperlink and performs an HTTP GET |
| `writeSpreadsheet` | Writes data to a range, overwriting existing values      |
| `appendRows`       | Appends rows to the end of a sheet                       |
| `clearRange`       | Clears all cell values in a range without deleting cells |

## Formatting & Validation

| Tool                    | Description                                                             |
| ----------------------- | ----------------------------------------------------------------------- |
| `formatCells`           | Applies formatting (bold, colors, alignment) to a range, row, or column |
| `freezeRowsAndColumns`  | Pins rows and/or columns so they stay visible when scrolling            |
| `setDropdownValidation` | Adds a dropdown list to cells, restricting input to specified values    |

## Management

| Tool                 | Description                                            |
| -------------------- | ------------------------------------------------------ |
| `getSpreadsheetInfo` | Gets metadata about a spreadsheet including all sheets |
| `addSheet`           | Adds a new sheet (tab) to an existing spreadsheet      |
| `createSpreadsheet`  | Creates a new spreadsheet                              |
| `listSpreadsheets`   | Lists spreadsheets in your Drive                       |

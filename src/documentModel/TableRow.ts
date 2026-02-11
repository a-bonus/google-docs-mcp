// src/documentModel/TableRow.ts
import { docs_v1 } from 'googleapis';
import { TableCell } from './TableCell.js';
import type { Table } from './Table.js';

/**
 * Represents a row in a table
 */
export class TableRow {
    public rawRow: docs_v1.Schema$TableRow;
    public rowIndex: number;
    public cells: TableCell[];
    public parentTable: Table;

    constructor(rawRow: docs_v1.Schema$TableRow, rowIndex: number, parentTable: Table) {
        this.rawRow = rawRow;
        this.rowIndex = rowIndex;
        this.parentTable = parentTable;
        this.cells = [];

        if (rawRow.tableCells) {
            this.cells = rawRow.tableCells.map((cell, colIndex) =>
                new TableCell(cell, rowIndex, colIndex, parentTable)
            );
        }
    }

    /**
     * Get all text from this row
     */
    getText(): string {
        return this.cells.map(cell => cell.getText()).join('\t');
    }

    /**
     * Get cell by column index
     */
    getCell(columnIndex: number): TableCell | null {
        return this.cells[columnIndex] || null;
    }
}

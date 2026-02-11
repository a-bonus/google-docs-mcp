// src/documentModel/Table.ts
import { docs_v1 } from 'googleapis';
import { TableRow } from './TableRow.js';
import { TableCell } from './TableCell.js';

/**
 * Represents a table in a Google Document
 * Provides intuitive access to cells by row/column indices
 */
export class Table {
    public rawTable: docs_v1.Schema$Table;
    public startIndex: number | null | undefined;
    public endIndex: number | null | undefined;
    public rows: TableRow[];

    constructor(
        rawTable: docs_v1.Schema$Table,
        startIndex: number | null | undefined,
        endIndex: number | null | undefined
    ) {
        this.rawTable = rawTable;
        this.startIndex = startIndex;
        this.endIndex = endIndex;
        this.rows = [];

        if (rawTable.tableRows) {
            this.rows = rawTable.tableRows.map((row, index) =>
                new TableRow(row, index, this)
            );
        }
    }

    /**
     * Get table dimensions
     */
    get rowCount(): number {
        return this.rows.length;
    }

    get columnCount(): number {
        return this.rows[0]?.cells.length || 0;
    }

    /**
     * Get a specific cell by row and column indices
     * @param rowIndex - 0-based row index
     * @param columnIndex - 0-based column index
     * @returns The cell, or null if indices are out of bounds
     */
    cell(rowIndex: number, columnIndex: number): TableCell | null {
        const row = this.rows[rowIndex];
        if (!row) {
            return null;
        }

        return row.cells[columnIndex] || null;
    }

    /**
     * Get all text content from the table
     */
    getText(): string {
        let text = '';
        for (const row of this.rows) {
            for (const cell of row.cells) {
                text += cell.getText();
            }
        }
        return text;
    }

    /**
     * Find cells containing specific text
     */
    findCells(predicate: (cell: TableCell) => boolean): TableCell[] {
        const matches: TableCell[] = [];

        for (const row of this.rows) {
            for (const cell of row.cells) {
                if (predicate(cell)) {
                    matches.push(cell);
                }
            }
        }

        return matches;
    }

    /**
     * Find cells by text content
     */
    findCellsByText(query: string): TableCell[] {
        return this.findCells(cell => cell.getText().includes(query));
    }

    /**
     * Get a specific row
     */
    getRow(rowIndex: number): TableRow | null {
        return this.rows[rowIndex] || null;
    }

    /**
     * Get all cells in a specific column
     */
    getColumn(columnIndex: number): TableCell[] {
        return this.rows
            .map(row => row.cells[columnIndex])
            .filter(cell => cell !== undefined);
    }
}

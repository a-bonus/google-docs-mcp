// src/documentModel/TableCell.ts
import { docs_v1 } from 'googleapis';
import type { Table } from './Table.js';

/**
 * Represents a cell in a table
 * Provides access to cell content and metadata
 */
export class TableCell {
    public rawCell: docs_v1.Schema$TableCell;
    public rowIndex: number;
    public columnIndex: number;
    public parentTable: Table;

    constructor(
        rawCell: docs_v1.Schema$TableCell,
        rowIndex: number,
        columnIndex: number,
        parentTable: Table
    ) {
        this.rawCell = rawCell;
        this.rowIndex = rowIndex;
        this.columnIndex = columnIndex;
        this.parentTable = parentTable;
    }

    /**
     * Get all text content from the cell
     */
    getText(): string {
        let text = '';

        if (this.rawCell.content) {
            for (const element of this.rawCell.content) {
                if (element.paragraph?.elements) {
                    for (const paragraphElement of element.paragraph.elements) {
                        if (paragraphElement.textRun?.content) {
                            text += paragraphElement.textRun.content;
                        }
                    }
                }
            }
        }

        return text;
    }

    /**
     * Get the cell's content start and end indices
     * Returns null if indices cannot be determined
     */
    getRange(): { startIndex: number; endIndex: number } | null {
        if (!this.rawCell.content || this.rawCell.content.length === 0) {
            return null;
        }

        const firstElement = this.rawCell.content[0];
        const lastElement = this.rawCell.content[this.rawCell.content.length - 1];

        if (firstElement.startIndex === null || firstElement.startIndex === undefined ||
            lastElement.endIndex === null || lastElement.endIndex === undefined) {
            return null;
        }

        return {
            startIndex: firstElement.startIndex,
            endIndex: lastElement.endIndex
        };
    }

    /**
     * Check if cell is empty
     */
    isEmpty(): boolean {
        const text = this.getText().trim();
        return text.length === 0 || text === '\n';
    }

    /**
     * Get cell location as a string (e.g., "R1C2" for row 1, column 2)
     */
    get location(): string {
        return `R${this.rowIndex}C${this.columnIndex}`;
    }
}

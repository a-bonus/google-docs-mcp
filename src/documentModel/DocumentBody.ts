// src/documentModel/DocumentBody.ts
import { docs_v1 } from 'googleapis';
import { StructuralElement } from './StructuralElement.js';
import { Paragraph } from './Paragraph.js';
import { Table } from './Table.js';

/**
 * Represents the body of a Google Document
 * Contains all the document's content (paragraphs, tables, etc.)
 */
export class DocumentBody {
    private rawBody: docs_v1.Schema$Body | null | undefined;
    public content: StructuralElement[];
    public paragraphs: Paragraph[];
    public tables: Table[];

    constructor(rawBody: docs_v1.Schema$Body | null | undefined) {
        this.rawBody = rawBody;
        this.content = [];
        this.paragraphs = [];
        this.tables = [];

        if (rawBody?.content) {
            this.parseContent(rawBody.content);
        }
    }

    private parseContent(rawContent: docs_v1.Schema$StructuralElement[]): void {
        for (const element of rawContent) {
            const structuralElement = new StructuralElement(element);
            this.content.push(structuralElement);

            // Collect paragraphs
            if (element.paragraph) {
                this.paragraphs.push(new Paragraph(element.paragraph, element.startIndex, element.endIndex));
            }

            // Collect tables
            if (element.table) {
                this.tables.push(new Table(element.table, element.startIndex, element.endIndex));
            }
        }
    }

    /**
     * Get all text content from the body
     */
    getText(): string {
        let text = '';
        for (const paragraph of this.paragraphs) {
            text += paragraph.getText();
        }
        for (const table of this.tables) {
            text += table.getText();
        }
        return text;
    }

    /**
     * Find paragraphs containing specific text
     */
    findParagraphs(query: string): Paragraph[] {
        return this.paragraphs.filter(p => p.getText().includes(query));
    }

    /**
     * Find tables
     */
    findTables(): Table[] {
        return this.tables;
    }

    /**
     * Get the start and end indices of the body
     */
    get startIndex(): number | null | undefined {
        return this.content[0]?.startIndex;
    }

    get endIndex(): number | null | undefined {
        const lastElement = this.content[this.content.length - 1];
        return lastElement?.endIndex;
    }
}

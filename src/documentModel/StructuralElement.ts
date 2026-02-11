// src/documentModel/StructuralElement.ts
import { docs_v1 } from 'googleapis';

/**
 * Represents a structural element in a Google Document
 * Can be a paragraph, table, section break, or table of contents
 */
export class StructuralElement {
    public rawElement: docs_v1.Schema$StructuralElement;

    constructor(rawElement: docs_v1.Schema$StructuralElement) {
        this.rawElement = rawElement;
    }

    get startIndex(): number | null | undefined {
        return this.rawElement.startIndex;
    }

    get endIndex(): number | null | undefined {
        return this.rawElement.endIndex;
    }

    get isParagraph(): boolean {
        return !!this.rawElement.paragraph;
    }

    get isTable(): boolean {
        return !!this.rawElement.table;
    }

    get isSectionBreak(): boolean {
        return !!this.rawElement.sectionBreak;
    }

    get isTableOfContents(): boolean {
        return !!this.rawElement.tableOfContents;
    }
}

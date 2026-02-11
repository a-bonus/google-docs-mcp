// src/documentModel/Paragraph.ts
import { docs_v1 } from 'googleapis';

/**
 * Represents a paragraph in a Google Document
 */
export class Paragraph {
    public rawParagraph: docs_v1.Schema$Paragraph;
    public startIndex: number | null | undefined;
    public endIndex: number | null | undefined;

    constructor(
        rawParagraph: docs_v1.Schema$Paragraph,
        startIndex: number | null | undefined,
        endIndex: number | null | undefined
    ) {
        this.rawParagraph = rawParagraph;
        this.startIndex = startIndex;
        this.endIndex = endIndex;
    }

    /**
     * Get all text content from the paragraph
     */
    getText(): string {
        let text = '';

        if (this.rawParagraph.elements) {
            for (const element of this.rawParagraph.elements) {
                if (element.textRun?.content) {
                    text += element.textRun.content;
                }
            }
        }

        return text;
    }

    /**
     * Find text within this paragraph
     */
    findText(query: string): { startIndex: number; endIndex: number } | null {
        const text = this.getText();
        const position = text.indexOf(query);

        if (position === -1 || this.startIndex === null || this.startIndex === undefined) {
            return null;
        }

        return {
            startIndex: this.startIndex + position,
            endIndex: this.startIndex + position + query.length
        };
    }

    /**
     * Get paragraph style
     */
    get style(): docs_v1.Schema$ParagraphStyle | null | undefined {
        return this.rawParagraph.paragraphStyle;
    }

    /**
     * Get named style type (e.g., HEADING_1, NORMAL_TEXT)
     */
    get namedStyleType(): string | null | undefined {
        return this.rawParagraph.paragraphStyle?.namedStyleType;
    }
}

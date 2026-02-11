// src/documentModel/GoogleDoc.ts
import { docs_v1 } from 'googleapis';
import { DocumentBody } from './DocumentBody.js';
import { Tab } from './Tab.js';

/**
 * Represents a Google Document with its structure and content.
 * Provides a high-level object model for navigating and querying the document.
 *
 * Example:
 * ```typescript
 * const doc = await GoogleDoc.load(docs, documentId);
 * const firstTable = doc.body.tables[0];
 * const cell = firstTable.cell(0, 1);
 * console.log(cell.getText());
 * ```
 */
export class GoogleDoc {
    private rawDocument: docs_v1.Schema$Document;
    public body: DocumentBody;
    public tabs: Tab[];
    public documentId: string;

    private constructor(rawDocument: docs_v1.Schema$Document, documentId: string) {
        this.rawDocument = rawDocument;
        this.documentId = documentId;

        // Parse document structure
        if (rawDocument.tabs && rawDocument.tabs.length > 0) {
            // Document with tabs
            this.tabs = rawDocument.tabs.map(tab => new Tab(tab));
            // Use first tab's body as main body
            this.body = new DocumentBody(this.tabs[0].rawTab.documentTab?.body);
        } else {
            // Legacy document without tabs
            this.tabs = [];
            this.body = new DocumentBody(rawDocument.body);
        }
    }

    /**
     * Load a Google Document and parse it into the object model
     */
    static async load(
        docs: docs_v1.Docs,
        documentId: string,
        includeTabsContent: boolean = false
    ): Promise<GoogleDoc> {
        const response = await docs.documents.get({
            documentId,
            includeTabsContent
        });

        if (!response.data) {
            throw new Error(`Failed to load document ${documentId}`);
        }

        return new GoogleDoc(response.data, documentId);
    }

    /**
     * Get the document title
     */
    get title(): string {
        return this.rawDocument.title || 'Untitled';
    }

    /**
     * Get the document's revision ID
     */
    get revisionId(): string | null | undefined {
        return this.rawDocument.revisionId;
    }

    /**
     * Get the raw Google Docs API response (for advanced use cases)
     */
    getRawDocument(): docs_v1.Schema$Document {
        return this.rawDocument;
    }

    /**
     * Find a tab by ID
     */
    findTabById(tabId: string): Tab | null {
        return this.tabs.find(tab => tab.id === tabId) || null;
    }

    /**
     * Get tab by index
     */
    getTab(index: number): Tab | null {
        return this.tabs[index] || null;
    }
}

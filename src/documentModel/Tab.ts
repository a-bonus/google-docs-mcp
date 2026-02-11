// src/documentModel/Tab.ts
import { docs_v1 } from 'googleapis';
import { DocumentBody } from './DocumentBody.js';

/**
 * Represents a tab within a Google Document
 */
export class Tab {
    public rawTab: docs_v1.Schema$Tab;
    public body: DocumentBody | null;

    constructor(rawTab: docs_v1.Schema$Tab) {
        this.rawTab = rawTab;
        this.body = rawTab.documentTab?.body
            ? new DocumentBody(rawTab.documentTab.body)
            : null;
    }

    /**
     * Get tab ID
     */
    get id(): string | null | undefined {
        return this.rawTab.tabProperties?.tabId;
    }

    /**
     * Get tab title
     */
    get title(): string | null | undefined {
        return this.rawTab.tabProperties?.title;
    }

    /**
     * Get tab index
     */
    get index(): number | null | undefined {
        return this.rawTab.tabProperties?.index;
    }
}

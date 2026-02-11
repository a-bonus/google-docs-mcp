// src/documentContext.ts
import { google, docs_v1 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import * as GDocsHelpers from './googleDocsApiHelpers.js';
import { TextStyleArgs, ParagraphStyleArgs } from './types.js';

type Docs = docs_v1.Docs;

/**
 * DocumentContext provides a request queue pattern (similar to Office.js Word.run())
 * for batching multiple operations into a single API call.
 *
 * Example usage:
 * ```typescript
 * const ctx = new DocumentContext(docs, documentId);
 * ctx.insertText(100, "Hello");
 * ctx.insertText(500, "World");
 * ctx.applyTextStyle(100, 105, { bold: true });
 * await ctx.commit(); // Single API call
 * ```
 *
 * Benefits:
 * - Multiple operations batched into single API call (faster)
 * - Automatic descending index ordering (prevents index drift)
 * - Cleaner code (queue ops, commit once)
 * - Follows industry best practices (Office.js pattern)
 */
export class DocumentContext {
    private requests: docs_v1.Schema$Request[] = [];
    private docs: Docs;
    private documentId: string;
    private committed: boolean = false;

    constructor(docs: Docs, documentId: string) {
        this.docs = docs;
        this.documentId = documentId;
    }

    /**
     * Queue an insertText operation
     */
    insertText(index: number, text: string, tabId?: string): void {
        this.ensureNotCommitted();
        const request: docs_v1.Schema$Request = {
            insertText: {
                location: { index, ...(tabId && { tabId }) },
                text
            }
        };
        this.requests.push(request);
    }

    /**
     * Queue an insertTable operation
     */
    insertTable(index: number, rows: number, columns: number, tabId?: string): void {
        this.ensureNotCommitted();
        const request: docs_v1.Schema$Request = {
            insertTable: {
                location: { index, ...(tabId && { tabId }) },
                rows,
                columns
            }
        };
        this.requests.push(request);
    }

    /**
     * Queue a deleteContentRange operation
     */
    deleteRange(startIndex: number, endIndex: number, tabId?: string): void {
        this.ensureNotCommitted();
        const request: docs_v1.Schema$Request = {
            deleteContentRange: {
                range: {
                    startIndex,
                    endIndex,
                    ...(tabId && { tabId })
                }
            }
        };
        this.requests.push(request);
    }

    /**
     * Queue an updateTextStyle operation
     */
    applyTextStyle(startIndex: number, endIndex: number, style: TextStyleArgs, tabId?: string): void {
        this.ensureNotCommitted();
        const styleRequest = GDocsHelpers.buildUpdateTextStyleRequest(
            startIndex,
            endIndex,
            style,
            tabId
        );

        if (styleRequest) {
            this.requests.push(styleRequest.request);
        }
    }

    /**
     * Queue an updateParagraphStyle operation
     */
    applyParagraphStyle(startIndex: number, endIndex: number, style: ParagraphStyleArgs, tabId?: string): void {
        this.ensureNotCommitted();
        const styleRequest = GDocsHelpers.buildUpdateParagraphStyleRequest(
            startIndex,
            endIndex,
            style,
            tabId
        );

        if (styleRequest) {
            this.requests.push(styleRequest.request);
        }
    }

    /**
     * Queue an insertPageBreak operation
     */
    insertPageBreak(index: number, tabId?: string): void {
        this.ensureNotCommitted();
        const request: docs_v1.Schema$Request = {
            insertPageBreak: {
                location: { index, ...(tabId && { tabId }) }
            }
        };
        this.requests.push(request);
    }

    /**
     * Queue an insertInlineImage operation
     */
    insertInlineImage(index: number, imageUrl: string, width?: number, height?: number, tabId?: string): void {
        this.ensureNotCommitted();
        const request: docs_v1.Schema$Request = {
            insertInlineImage: {
                location: { index, ...(tabId && { tabId }) },
                uri: imageUrl,
                ...(width && height && {
                    objectSize: {
                        height: { magnitude: height, unit: 'PT' },
                        width: { magnitude: width, unit: 'PT' }
                    }
                })
            }
        };
        this.requests.push(request);
    }

    /**
     * Add a custom request directly (for advanced use cases)
     */
    addRequest(request: docs_v1.Schema$Request): void {
        this.ensureNotCommitted();
        this.requests.push(request);
    }

    /**
     * Get the number of queued requests
     */
    get queuedCount(): number {
        return this.requests.length;
    }

    /**
     * Check if there are any queued requests
     */
    get hasQueuedRequests(): boolean {
        return this.requests.length > 0;
    }

    /**
     * Check if this context has been committed
     */
    get isCommitted(): boolean {
        return this.committed;
    }

    /**
     * Commit all queued operations to the document in a single API call
     * Operations are automatically sorted by descending index order (Google best practice)
     *
     * @returns The batch update response from Google Docs API
     */
    async commit(): Promise<docs_v1.Schema$BatchUpdateDocumentResponse> {
        this.ensureNotCommitted();

        if (this.requests.length === 0) {
            this.committed = true;
            return {};
        }

        try {
            // Use executeBatchUpdateWithSplitting which handles sorting and splitting
            await GDocsHelpers.executeBatchUpdateWithSplitting(
                this.docs,
                this.documentId,
                this.requests
            );

            this.committed = true;
            return {}; // executeBatchUpdateWithSplitting doesn't return the response
        } catch (error) {
            // Don't mark as committed if there was an error
            throw error;
        }
    }

    /**
     * Clear all queued requests without executing them
     */
    clear(): void {
        this.requests = [];
        this.committed = false;
    }

    /**
     * Get a copy of the queued requests (for inspection/debugging)
     */
    getQueuedRequests(): docs_v1.Schema$Request[] {
        return [...this.requests];
    }

    private ensureNotCommitted(): void {
        if (this.committed) {
            throw new Error('Cannot add operations to a committed DocumentContext. Create a new context.');
        }
    }
}

/**
 * Helper function to create and use a DocumentContext in a single call
 * (similar to Office.js Word.run pattern)
 *
 * Example:
 * ```typescript
 * await runWithContext(docs, docId, async (ctx) => {
 *     ctx.insertText(100, "Hello");
 *     ctx.applyTextStyle(100, 105, { bold: true });
 *     // Automatically committed at end
 * });
 * ```
 */
export async function runWithContext(
    docs: Docs,
    documentId: string,
    fn: (ctx: DocumentContext) => Promise<void> | void
): Promise<docs_v1.Schema$BatchUpdateDocumentResponse> {
    const ctx = new DocumentContext(docs, documentId);
    await fn(ctx);
    return await ctx.commit();
}

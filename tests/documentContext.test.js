// tests/documentContext.test.js
import { DocumentContext, runWithContext } from '../dist/documentContext.js';
import assert from 'node:assert';
import { describe, it, beforeEach } from 'node:test';

// Mock Google Docs client
function createMockDocs() {
    const executedBatches = [];

    return {
        documents: {
            batchUpdate: async ({ documentId, requestBody }) => {
                executedBatches.push({
                    documentId,
                    requests: requestBody.requests
                });
                return { data: {} };
            }
        },
        executedBatches // For test inspection
    };
}

describe('DocumentContext', () => {
    let mockDocs;
    let ctx;
    const docId = 'test-doc-123';

    beforeEach(() => {
        mockDocs = createMockDocs();
        ctx = new DocumentContext(mockDocs, docId);
    });

    describe('Request Queuing', () => {
        it('should queue insertText operations', () => {
            ctx.insertText(100, "Hello");
            ctx.insertText(200, "World");

            assert.strictEqual(ctx.queuedCount, 2);
            assert.strictEqual(ctx.hasQueuedRequests, true);
        });

        it('should queue insertTable operations', () => {
            ctx.insertTable(100, 3, 4);

            assert.strictEqual(ctx.queuedCount, 1);

            const requests = ctx.getQueuedRequests();
            assert.strictEqual(requests[0].insertTable.rows, 3);
            assert.strictEqual(requests[0].insertTable.columns, 4);
        });

        it('should queue deleteRange operations', () => {
            ctx.deleteRange(50, 60);

            assert.strictEqual(ctx.queuedCount, 1);

            const requests = ctx.getQueuedRequests();
            assert.strictEqual(requests[0].deleteContentRange.range.startIndex, 50);
            assert.strictEqual(requests[0].deleteContentRange.range.endIndex, 60);
        });

        it('should queue applyTextStyle operations', () => {
            ctx.applyTextStyle(100, 105, { bold: true });

            assert.strictEqual(ctx.queuedCount, 1);

            const requests = ctx.getQueuedRequests();
            assert.ok(requests[0].updateTextStyle);
            assert.strictEqual(requests[0].updateTextStyle.textStyle.bold, true);
        });

        it('should queue applyParagraphStyle operations', () => {
            ctx.applyParagraphStyle(100, 150, { alignment: 'CENTER' });

            assert.strictEqual(ctx.queuedCount, 1);

            const requests = ctx.getQueuedRequests();
            assert.ok(requests[0].updateParagraphStyle);
            assert.strictEqual(requests[0].updateParagraphStyle.paragraphStyle.alignment, 'CENTER');
        });

        it('should queue insertPageBreak operations', () => {
            ctx.insertPageBreak(200);

            assert.strictEqual(ctx.queuedCount, 1);

            const requests = ctx.getQueuedRequests();
            assert.ok(requests[0].insertPageBreak);
            assert.strictEqual(requests[0].insertPageBreak.location.index, 200);
        });

        it('should queue insertInlineImage operations', () => {
            ctx.insertInlineImage(300, 'https://example.com/image.png', 100, 100);

            assert.strictEqual(ctx.queuedCount, 1);

            const requests = ctx.getQueuedRequests();
            assert.ok(requests[0].insertInlineImage);
            assert.strictEqual(requests[0].insertInlineImage.uri, 'https://example.com/image.png');
        });

        it('should allow adding custom requests', () => {
            const customRequest = {
                createParagraphBullets: {
                    range: { startIndex: 1, endIndex: 10 },
                    bulletPreset: 'BULLET_DISC_CIRCLE_SQUARE'
                }
            };

            ctx.addRequest(customRequest);

            assert.strictEqual(ctx.queuedCount, 1);

            const requests = ctx.getQueuedRequests();
            assert.ok(requests[0].createParagraphBullets);
        });
    });

    describe('Commit Behavior', () => {
        it('should commit queued operations', async () => {
            ctx.insertText(100, "Test");
            ctx.insertText(200, "Test2");

            assert.strictEqual(ctx.isCommitted, false);

            await ctx.commit();

            assert.strictEqual(ctx.isCommitted, true);
            assert.strictEqual(mockDocs.executedBatches.length, 1);
        });

        it('should not allow operations after commit', async () => {
            ctx.insertText(100, "Test");
            await ctx.commit();

            assert.throws(() => {
                ctx.insertText(200, "Should fail");
            }, /Cannot add operations to a committed DocumentContext/);
        });

        it('should handle empty commit', async () => {
            assert.strictEqual(ctx.queuedCount, 0);

            await ctx.commit();

            assert.strictEqual(ctx.isCommitted, true);
            // executeBatchUpdateWithSplitting doesn't execute if no requests
            assert.strictEqual(mockDocs.executedBatches.length, 0);
        });

        it('should allow clearing operations before commit', () => {
            ctx.insertText(100, "Test");
            ctx.insertText(200, "Test2");

            assert.strictEqual(ctx.queuedCount, 2);

            ctx.clear();

            assert.strictEqual(ctx.queuedCount, 0);
            assert.strictEqual(ctx.isCommitted, false);
        });

        it('should allow re-use after clear', async () => {
            ctx.insertText(100, "First");
            await ctx.commit();

            // Can't add more to committed context
            assert.throws(() => {
                ctx.insertText(200, "Should fail");
            });

            // But after clear, can use again
            ctx.clear();

            assert.strictEqual(ctx.isCommitted, false);
            ctx.insertText(300, "After clear");
            assert.strictEqual(ctx.queuedCount, 1);
        });
    });

    describe('Tab Support', () => {
        it('should include tabId in insertText when provided', () => {
            ctx.insertText(100, "Test", "tab123");

            const requests = ctx.getQueuedRequests();
            assert.strictEqual(requests[0].insertText.location.tabId, "tab123");
        });

        it('should include tabId in deleteRange when provided', () => {
            ctx.deleteRange(50, 60, "tab456");

            const requests = ctx.getQueuedRequests();
            assert.strictEqual(requests[0].deleteContentRange.range.tabId, "tab456");
        });

        it('should include tabId in applyTextStyle when provided', () => {
            ctx.applyTextStyle(100, 105, { bold: true }, "tab789");

            const requests = ctx.getQueuedRequests();
            assert.strictEqual(requests[0].updateTextStyle.range.tabId, "tab789");
        });
    });

    describe('getQueuedRequests', () => {
        it('should return a copy of requests (immutable)', () => {
            ctx.insertText(100, "Test");

            const requests1 = ctx.getQueuedRequests();
            const requests2 = ctx.getQueuedRequests();

            // Should be different arrays (copies)
            assert.notStrictEqual(requests1, requests2);

            // But with same content
            assert.deepStrictEqual(requests1, requests2);

            // Modifying returned array should not affect context
            requests1.push({ insertText: { location: { index: 999 }, text: "Fake" } });

            assert.strictEqual(ctx.queuedCount, 1); // Still just 1
        });
    });
});

describe('runWithContext Helper', () => {
    it('should create context, run function, and auto-commit', async () => {
        const mockDocs = createMockDocs();
        const docId = 'test-doc-456';

        await runWithContext(mockDocs, docId, async (ctx) => {
            ctx.insertText(100, "Hello");
            ctx.insertText(200, "World");
        });

        // Should have executed batch
        assert.strictEqual(mockDocs.executedBatches.length, 1);
    });

    it('should work with synchronous functions', async () => {
        const mockDocs = createMockDocs();
        const docId = 'test-doc-789';

        await runWithContext(mockDocs, docId, (ctx) => {
            ctx.insertText(100, "Sync");
        });

        assert.strictEqual(mockDocs.executedBatches.length, 1);
    });

    it('should propagate errors from function', async () => {
        const mockDocs = createMockDocs();
        const docId = 'test-doc-error';

        await assert.rejects(
            async () => {
                await runWithContext(mockDocs, docId, async (ctx) => {
                    ctx.insertText(100, "Test");
                    throw new Error("Test error");
                });
            },
            /Test error/
        );
    });
});

describe('Real-world Usage Patterns', () => {
    it('should batch multiple formatting operations efficiently', async () => {
        const mockDocs = createMockDocs();
        const ctx = new DocumentContext(mockDocs, 'doc-123');

        // Common pattern: Insert text and format it
        ctx.insertText(1, "Header Text");
        ctx.applyTextStyle(1, 12, { bold: true, fontSize: 16 });
        ctx.applyParagraphStyle(1, 12, { alignment: 'CENTER' });

        ctx.insertText(12, "\n\nBody paragraph with normal text.");
        ctx.insertText(45, " Bold part.");
        ctx.applyTextStyle(45, 56, { bold: true });

        assert.strictEqual(ctx.queuedCount, 6);

        await ctx.commit();

        // executeBatchUpdateWithSplitting groups by type: insert + format = 2 batches
        assert.ok(mockDocs.executedBatches.length >= 1);
        assert.ok(mockDocs.executedBatches.length <= 3); // At most: delete, insert, format
    });

    it('should handle table creation and formatting', async () => {
        const mockDocs = createMockDocs();
        const ctx = new DocumentContext(mockDocs, 'doc-456');

        // Insert table
        ctx.insertTable(1, 3, 4);

        // Note: Can't format cells yet without knowing their indices
        // This will be easier once we have the document model

        await ctx.commit();

        assert.strictEqual(mockDocs.executedBatches.length, 1);
    });

    it('should demonstrate Office.js-style pattern', async () => {
        const mockDocs = createMockDocs();

        // This is how users will write code (Office.js style)
        await runWithContext(mockDocs, 'doc-789', async (ctx) => {
            // Build document structure
            ctx.insertText(1, "Document Title");
            ctx.applyParagraphStyle(1, 15, { namedStyleType: 'HEADING_1' });

            ctx.insertText(15, "\n\nIntroduction paragraph.");

            ctx.insertPageBreak(39);

            ctx.insertText(40, "Section 2");
            ctx.applyParagraphStyle(40, 49, { namedStyleType: 'HEADING_2' });

            // All operations automatically batched and executed
        });

        // Operations grouped by type (insert + format), so multiple batches
        assert.ok(mockDocs.executedBatches.length >= 1);
    });
});

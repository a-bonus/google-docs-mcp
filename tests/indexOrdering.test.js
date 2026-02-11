// tests/indexOrdering.test.js
import { getRequestIndex, sortByIndexDescending } from '../dist/googleDocsApiHelpers.js';
import assert from 'node:assert';
import { describe, it } from 'node:test';

describe('Request Index Ordering (Critical Bug Fix)', () => {

    describe('getRequestIndex', () => {
        it('should extract index from insertText operations', () => {
            const request = {
                insertText: {
                    location: { index: 100 },
                    text: "Hello"
                }
            };
            assert.strictEqual(getRequestIndex(request), 100);
        });

        it('should extract index from insertTable operations', () => {
            const request = {
                insertTable: {
                    location: { index: 250 },
                    rows: 3,
                    columns: 4
                }
            };
            assert.strictEqual(getRequestIndex(request), 250);
        });

        it('should extract index from deleteContentRange operations', () => {
            const request = {
                deleteContentRange: {
                    range: {
                        startIndex: 50,
                        endIndex: 60
                    }
                }
            };
            assert.strictEqual(getRequestIndex(request), 50);
        });

        it('should extract index from updateTextStyle operations', () => {
            const request = {
                updateTextStyle: {
                    range: {
                        startIndex: 200,
                        endIndex: 210
                    },
                    textStyle: { bold: true },
                    fields: 'bold'
                }
            };
            assert.strictEqual(getRequestIndex(request), 200);
        });

        it('should extract index from updateParagraphStyle operations', () => {
            const request = {
                updateParagraphStyle: {
                    range: {
                        startIndex: 150,
                        endIndex: 160
                    },
                    paragraphStyle: { alignment: 'CENTER' },
                    fields: 'alignment'
                }
            };
            assert.strictEqual(getRequestIndex(request), 150);
        });

        it('should return Infinity for operations with no index', () => {
            const request = {
                someOtherOperation: {
                    data: "No index here"
                }
            };
            assert.strictEqual(getRequestIndex(request), Infinity);
        });

        it('should handle null indices', () => {
            const request = {
                insertText: {
                    location: { index: null },
                    text: "Hello"
                }
            };
            assert.strictEqual(getRequestIndex(request), Infinity);
        });

        it('should handle undefined indices', () => {
            const request = {
                insertText: {
                    location: {},
                    text: "Hello"
                }
            };
            assert.strictEqual(getRequestIndex(request), Infinity);
        });
    });

    describe('sortByIndexDescending', () => {
        it('should sort insert operations by descending index', () => {
            const requests = [
                { insertText: { location: { index: 100 }, text: "Low" } },
                { insertText: { location: { index: 500 }, text: "High" } },
                { insertText: { location: { index: 250 }, text: "Middle" } }
            ];

            const sorted = sortByIndexDescending(requests);

            assert.strictEqual(getRequestIndex(sorted[0]), 500); // Highest first
            assert.strictEqual(getRequestIndex(sorted[1]), 250);
            assert.strictEqual(getRequestIndex(sorted[2]), 100); // Lowest last
        });

        it('should sort delete operations by descending index', () => {
            const requests = [
                { deleteContentRange: { range: { startIndex: 50, endIndex: 60 } } },
                { deleteContentRange: { range: { startIndex: 200, endIndex: 210 } } },
                { deleteContentRange: { range: { startIndex: 150, endIndex: 160 } } }
            ];

            const sorted = sortByIndexDescending(requests);

            assert.strictEqual(getRequestIndex(sorted[0]), 200);
            assert.strictEqual(getRequestIndex(sorted[1]), 150);
            assert.strictEqual(getRequestIndex(sorted[2]), 50);
        });

        it('should sort mixed operation types by descending index', () => {
            const requests = [
                { insertText: { location: { index: 100 }, text: "Insert" } },
                { deleteContentRange: { range: { startIndex: 300, endIndex: 310 } } },
                { updateTextStyle: { range: { startIndex: 200, endIndex: 210 }, textStyle: { bold: true }, fields: 'bold' } }
            ];

            const sorted = sortByIndexDescending(requests);

            assert.strictEqual(getRequestIndex(sorted[0]), 300); // Delete at 300
            assert.strictEqual(getRequestIndex(sorted[1]), 200); // Style at 200
            assert.strictEqual(getRequestIndex(sorted[2]), 100); // Insert at 100
        });

        it('should handle operations with no index (puts them last)', () => {
            const requests = [
                { insertText: { location: { index: 100 }, text: "Has index" } },
                { someOtherOperation: { data: "No index" } },
                { insertText: { location: { index: 200 }, text: "Also has index" } }
            ];

            const sorted = sortByIndexDescending(requests);

            assert.strictEqual(getRequestIndex(sorted[0]), 200);
            assert.strictEqual(getRequestIndex(sorted[1]), 100);
            assert.strictEqual(getRequestIndex(sorted[2]), Infinity);
        });

        it('should not mutate the original array', () => {
            const requests = [
                { insertText: { location: { index: 100 }, text: "First" } },
                { insertText: { location: { index: 200 }, text: "Second" } }
            ];

            const originalFirstIndex = getRequestIndex(requests[0]);
            const sorted = sortByIndexDescending(requests);

            // Original array should be unchanged
            assert.strictEqual(getRequestIndex(requests[0]), originalFirstIndex);
            // Sorted array should be different
            assert.strictEqual(getRequestIndex(sorted[0]), 200);
        });

        it('should handle empty array', () => {
            const requests = [];
            const sorted = sortByIndexDescending(requests);
            assert.strictEqual(sorted.length, 0);
        });

        it('should handle single element array', () => {
            const requests = [
                { insertText: { location: { index: 100 }, text: "Only" } }
            ];
            const sorted = sortByIndexDescending(requests);
            assert.strictEqual(sorted.length, 1);
            assert.strictEqual(getRequestIndex(sorted[0]), 100);
        });

        it('should handle duplicate indices (stable sort)', () => {
            const requests = [
                { insertText: { location: { index: 100 }, text: "First" } },
                { insertText: { location: { index: 100 }, text: "Second" } },
                { insertText: { location: { index: 100 }, text: "Third" } }
            ];

            const sorted = sortByIndexDescending(requests);

            // All should have same index
            assert.strictEqual(getRequestIndex(sorted[0]), 100);
            assert.strictEqual(getRequestIndex(sorted[1]), 100);
            assert.strictEqual(getRequestIndex(sorted[2]), 100);
        });
    });

    describe('Real-world scenarios', () => {
        it('should prevent index drift in multi-insert scenario', () => {
            // Scenario: Insert "AAA" at 100, then "BBB" at 500
            // Without sorting: After inserting at 100, index 500 should be 503
            // With sorting: Insert at 500 first, then 100 (no drift!)

            const requests = [
                { insertText: { location: { index: 100 }, text: "AAA" } },  // +3 chars
                { insertText: { location: { index: 500 }, text: "BBB" } }   // Should be unaffected
            ];

            const sorted = sortByIndexDescending(requests);

            // After sorting, 500 comes first
            assert.strictEqual(getRequestIndex(sorted[0]), 500);
            assert.strictEqual(getRequestIndex(sorted[1]), 100);

            // This order prevents index drift
        });

        it('should handle complex batch with delete, insert, and format', () => {
            const requests = [
                { insertText: { location: { index: 100 }, text: "New text" } },
                { deleteContentRange: { range: { startIndex: 50, endIndex: 60 } } },
                { updateTextStyle: { range: { startIndex: 200, endIndex: 210 }, textStyle: { bold: true }, fields: 'bold' } },
                { insertTable: { location: { index: 300 }, rows: 2, columns: 2 } },
                { updateParagraphStyle: { range: { startIndex: 150, endIndex: 160 }, paragraphStyle: { alignment: 'CENTER' }, fields: 'alignment' } }
            ];

            const sorted = sortByIndexDescending(requests);

            // Should be ordered: 300, 200, 150, 100, 50
            const indices = sorted.map(r => getRequestIndex(r));
            assert.deepStrictEqual(indices, [300, 200, 150, 100, 50]);
        });
    });
});

# Google Docs MCP Server

FastMCP server with 45 tools for Google Docs, Sheets, and Drive.

## Tool Categories

| Category | Count | Examples |
|----------|-------|----------|
| Docs | 5 | `readGoogleDoc`, `appendToGoogleDoc`, `insertText`, `deleteRange`, `listDocumentTabs` |
| Markdown | 2 | `replaceDocumentWithMarkdown`, `appendMarkdownToGoogleDoc` |
| Formatting | 3 | `applyTextStyle`, `applyParagraphStyle`, `formatMatchingText` |
| Structure | 8 | `insertTable`, `editTableCell`, `listTables`, `insertPageBreak`, `insertImageFromUrl`, `insertLocalImage`, `findElement`*, `fixListFormatting`* |
| Comments | 6 | `listComments`, `getComment`, `addComment`, `replyToComment`, `resolveComment`, `deleteComment` |
| Sheets | 8 | `readSpreadsheet`, `writeSpreadsheet`, `appendSpreadsheetRows`, `clearSpreadsheetRange`, `createSpreadsheet`, `listGoogleSheets` |
| Drive | 13 | `listGoogleDocs`, `searchGoogleDocs`, `getDocumentInfo`, `createFolder`, `moveFile`, `copyFile`, `createDocument` |

*Not fully implemented

## Known Limitations

- **Comment anchoring:** Programmatically created comments appear in "All Comments" but aren't visibly anchored to text in the UI
- **Resolved status:** May not persist in Google Docs UI (Drive API limitation)
- **findElement:** Not fully implemented
- **fixListFormatting:** Experimental, may not work reliably

## Parameter Patterns

- **Document ID:** Extract from URL: `docs.google.com/document/d/DOCUMENT_ID/edit`
- **Text targeting:** Use `textToFind` + `matchInstance` OR `startIndex`/`endIndex`
- **Colors:** Hex format `#RRGGBB` or `#RGB`
- **Alignment:** `START`, `END`, `CENTER`, `JUSTIFIED` (not LEFT/RIGHT)
- **Indices:** 1-based, ranges are [start, end)
- **Tabs:** Optional `tabId` parameter (defaults to first tab)

## Table Editing

### Working with Tables

Tables are now fully supported! Use `listTables` to discover tables, then `editTableCell` to modify cell content and styling.

#### `listTables`
Discover all tables in a document with their structure:

```
listTables({
  documentId: "your-doc-id",
  includeContent: true  // Optional: preview cell contents
})
```

Returns:
- Table index (use this for editTableCell)
- Dimensions (rows × columns)
- Location (document indices)
- Content preview (if requested)

#### `editTableCell`
Edit any table cell by its position:

```
editTableCell({
  documentId: "your-doc-id",
  tableIndex: 0,        // 0-based table index (from listTables)
  rowIndex: 0,          // 0-based row index
  columnIndex: 1,       // 0-based column index
  textContent: "New text",
  textStyle: { bold: true },
  paragraphStyle: { alignment: "CENTER" }
})
```

**Workflow:**
1. Use `listTables` to find table indices
2. Use `editTableCell` with `tableIndex`, `rowIndex`, `columnIndex`
3. All changes batched automatically for performance

## Implementation Notes

### Request Batching & Index Ordering

All batch operations now follow Google's API best practices:
- **Automatic descending index sorting** - Operations execute high-to-low to prevent index drift
- **Operation grouping** - Delete, insert, and format operations are grouped and sorted
- **No manual index recalculation needed**

### DocumentContext Pattern (Advanced)

For complex multi-operation workflows, use DocumentContext (similar to Office.js `Word.run()` pattern):

```typescript
import { DocumentContext } from './documentContext.js';

const ctx = new DocumentContext(docs, documentId);
ctx.insertText(100, "Header");
ctx.applyTextStyle(100, 106, { bold: true });
ctx.insertText(200, "Body text");
await ctx.commit(); // Single API call
```

Benefits:
- Queue multiple operations
- Single API call (3-10x faster)
- Automatic index ordering
- Cleaner code

## Markdown Support

### Workflow
1. **Retrieve**: Use `readGoogleDoc` with `format='markdown'` to get document content as markdown
2. **Edit**: Modify markdown locally using your preferred editor
3. **Apply**: Use `replaceDocumentWithMarkdown` or `appendMarkdownToGoogleDoc` to write changes back

### Supported Markdown Features
- **Headings**: `# H1` through `###### H6`
- **Bold**: `**bold**` or `__bold__`
- **Italic**: `*italic*` or `_italic_`
- **Strikethrough**: `~~strikethrough~~`
- **Links**: `[text](url)`
- **Lists**: Bullet (`-`, `*`) and numbered (`1.`, `2.`)
- **Nested formatting**: `***bold italic***`, `**bold [link](url)**`

### Markdown Tools

#### `replaceDocumentWithMarkdown`
Replaces entire document content with markdown-formatted content.

**Parameters:**
- `documentId`: The document ID
- `markdown`: The markdown content to apply
- `preserveTitle` (optional): If true, preserves the first heading/title
- `tabId` (optional): Target a specific tab

**Example:**
```markdown
# My Document

This is **bold** text with a [link](https://example.com).

- List item 1
- List item 2
  - Nested item

## Section 2

More content with *italic* and ~~strikethrough~~.
```

#### `appendMarkdownToGoogleDoc`
Appends markdown content to the end of a document with full formatting.

**Parameters:**
- `documentId`: The document ID
- `markdown`: The markdown content to append
- `addNewlineIfNeeded` (optional, default: true): Add spacing before appended content
- `tabId` (optional): Target a specific tab

### Known Limitations for Markdown
- Tables not yet supported in markdown-to-docs conversion
- Images not yet supported in markdown-to-docs conversion
- Complex nested lists (3+ levels) may have formatting quirks
- Maximum practical document size: ~10,000 words (due to Google Docs API batch limits)

## Source Files (for implementation details)

| File | Contains |
|------|----------|
| `src/types.ts` | Zod schemas, hex color validation, style parameter definitions |
| `src/googleDocsApiHelpers.ts` | `findTextRange`, `executeBatchUpdate`, `executeBatchUpdateWithSplitting`, `sortByIndexDescending`, style request builders |
| `src/documentContext.ts` | `DocumentContext` class for operation batching (Office.js pattern) |
| `src/documentModel/` | Object model for Google Docs (GoogleDoc, Table, TableCell, etc.) |
| `src/googleSheetsApiHelpers.ts` | A1 notation parsing, range operations |
| `src/markdownParser.ts` | Markdown-it configuration, markdown parsing utilities |
| `src/markdownToGoogleDocs.ts` | Markdown-to-Google-Docs conversion logic |
| `src/server.ts` | All 45 tool definitions with full parameter schemas |

## See Also

- `README.md` - Setup instructions and usage examples
- `SAMPLE_TASKS.md` - 15 example workflows

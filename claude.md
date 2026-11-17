# Google Docs MCP Server

FastMCP server with 130 tools for Google Docs, Sheets, Drive, Gmail, Calendar, and Apps Script.

## Tool Categories

| Category    | Count | Examples                                                                                                                                   |
| ----------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Docs        | 42    | `readDocument`, `insertText`, `modifyText`, `applyTextStyle`, `insertTable`, `listComments`, `listSuggestions`, `manageSuggestions`, ...   |
| Drive       | 19    | `createDocument`, `searchDriveFiles`, `moveFile`, `createMarkdownFile`, `readMarkdownFile`, `updateMarkdownFile`, ...                      |
| Sheets      | 44    | `readSpreadsheet`, `writeSpreadsheet`, `createTable`, `protectRange`, `addConditionalFormatting`, `insertChart`, ...                       |
| Gmail       | 14    | `listMessages`, `getMessage`, `sendEmail`, `trashMessage`, `modifyMessageLabels`, `listLabels`, `createDraft`, `listDrafts`, `triageInbox` |
| Calendar    | 5     | `listEvents`, `createEvent`, `updateEvent`, `deleteEvent`, `quickAddEvent`                                                                 |
| Apps Script | 3     | `createAppsScriptProject`, `getAppsScriptContent`, `updateAppsScriptContent`                                                               |
| Utils       | 3     | `appendMarkdown`, `replaceDocumentWithMarkdown`, `replaceRangeWithMarkdown`                                                                |

`appendTableRows` is registered in both Docs and Sheets variants under the same name.

## Shared Drives Support

The server supports Google Shared Drives. All Drive file operations (`files.list`, `files.get`, `files.create`, `files.update`, `files.copy`, `files.delete`, `permissions.create`) use `supportsAllDrives: true` and `includeItemsFromAllDrives: true` (for list operations), enabling agents to query, create, and update documents in shared drives.

## Known Limitations

- **Comment anchoring:** Programmatically created comments appear in "All Comments" but aren't visibly anchored to text in the UI
- **Resolved status:** May not persist in Google Docs UI (Drive API limitation)
- **fixListFormatting:** Experimental, may not work reliably
- **Gmail hard delete:** `trashMessage` only moves to Trash (reversible). Permanent deletion requires the full `https://mail.google.com/` scope, which is not requested.
- **Gmail attachment downloads:** `downloadMessageAttachment` saves one attachment per call, stdio mode only, inside `GOOGLE_DOCS_MCP_DOWNLOAD_ROOTS`, which must be set (no cwd fallback).
- **Gmail draft attachments:** `createDraft` and `updateDraft` attach local files only from the directories in `GMAIL_ATTACHMENT_ROOTS`. Unset means every attachment is refused.
- **Gmail send format:** `sendEmail` is plain-text only. HTML bodies are delivered as literal text.
- **Calendar scope:** `calendar.events` covers event CRUD only. Cannot create or delete entire calendars.
- **Calendar recurring events:** `updateEvent` and `deleteEvent` operate on the entire series unless you target a specific instance ID from `listEvents` with `singleEvents=true`.

## Parameter Patterns

- **Document ID:** Extract from URL: `docs.google.com/document/d/DOCUMENT_ID/edit`
- **Text targeting:** Use `textToFind` + `matchInstance` OR `startIndex`/`endIndex`
- **Colors:** Hex format `#RRGGBB` or `#RGB`
- **Alignment:** `START`, `END`, `CENTER`, `JUSTIFIED` (not LEFT/RIGHT)
- **Indices:** 1-based, ranges are [start, end)
- **Tabs:** Optional `tabId` parameter (defaults to first tab)

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
- **Code blocks**: Fenced code blocks (` ``` `) rendered as styled 1x1 tables (matching Google Docs' native Code Block building block)
- **Inline code**: Backtick code rendered with monospace font + green color + gray background
- **Nested formatting**: `***bold italic***`, `**bold [link](url)**`

### Markdown Tools

#### `replaceDocumentWithMarkdown`

Replaces entire document content with markdown-formatted content.

**Parameters:**

- `documentId`: The document ID
- `markdown`: The markdown content to apply
- `preserveTitle` (optional): If true, preserves the first heading/title
- `firstHeadingAsTitle` (optional, default: false): If true, the first `# H1` is styled as a Google Docs **Title** instead of Heading 1
- `tabId` (optional): Target a specific tab

**Example:**

```markdown
# My Document

This is **bold** text with a [link](https://example.com).

- List item 1
- List item 2
  - Nested item

## Section 2

More content with _italic_ and ~~strikethrough~~.
```

#### `appendMarkdownToGoogleDoc`

Appends markdown content to the end of a document with full formatting.

**Parameters:**

- `documentId`: The document ID
- `markdown`: The markdown content to append
- `addNewlineIfNeeded` (optional, default: true): Add spacing before appended content
- `firstHeadingAsTitle` (optional, default: false): If true, the first `# H1` is styled as a Google Docs **Title** instead of Heading 1
- `tabId` (optional): Target a specific tab

### Known Limitations for Markdown

- Tables not yet supported in markdown-to-docs conversion
- Images not yet supported in markdown-to-docs conversion
- Complex nested lists (3+ levels) may have formatting quirks
- Maximum practical document size: ~10,000 words (due to Google Docs API batch limits)

## Source Files (for implementation details)

| File                                         | Contains                                                                                         |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `src/types.ts`                               | Zod schemas, hex color validation, style parameter definitions                                   |
| `src/googleDocsApiHelpers.ts`                | `findTextRange`, `executeBatchUpdate`, `executeBatchUpdateWithSplitting`, style request builders |
| `src/googleSheetsApiHelpers.ts`              | A1 notation parsing, range/format operations, protected-range helpers, table helpers             |
| `src/markdown-transformer/markdownToDocs.ts` | Markdown-to-Google-Docs conversion logic                                                         |
| `src/markdown-transformer/docsToMarkdown.ts` | Google-Docs-to-Markdown conversion logic                                                         |
| `src/markdown-transformer/index.ts`          | Markdown-it configuration and public API                                                         |
| `src/index.ts`                               | Entry point, CLI handling, and MCP server startup                                                |

## See Also

- `README.md` - Setup instructions and usage examples
- `SAMPLE_TASKS.md` - 15 example workflows

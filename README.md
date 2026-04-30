# Google Docs, Sheets, Drive, Gmail & Calendar MCP Server

![Demo Animation](assets/google.docs.mcp.1.gif)

Connect Claude Desktop, Cursor, or any MCP client to your Google Docs, Google Sheets, Google Drive, Gmail, and Google Calendar.

---

## Quick Start

### 1. Create a Google Cloud OAuth Client

1. Go to the [Google Cloud Console](https://console.cloud.google.com/)
2. Create or select a project
3. Enable the **Google Docs API**, **Google Sheets API**, **Google Drive API**, **Gmail API**, and **Google Calendar API**
4. Configure the **OAuth consent screen** (External, add your email as a test user, and add the `gmail.modify` and `calendar.events` scopes alongside the Docs/Sheets/Drive scopes)
5. Create an **OAuth client ID** (Desktop app type)
6. Copy the **Client ID** and **Client Secret** from the confirmation screen

> Need more detail? See [step-by-step instructions](#google-cloud-setup-details) at the bottom of this page.

### 2. Authorize

```bash
GOOGLE_CLIENT_ID="your-client-id" \
GOOGLE_CLIENT_SECRET="your-client-secret" \
npx -y @a-bonus/google-docs-mcp auth
```

This opens your browser for Google authorization. After you approve, the refresh token is saved to `~/.config/google-docs-mcp/token.json`.

### 3. Add to Your MCP Client

**Claude Desktop / Cursor / Windsurf:**

```json
{
  "mcpServers": {
    "google-docs": {
      "command": "npx",
      "args": ["-y", "@a-bonus/google-docs-mcp"],
      "env": {
        "GOOGLE_CLIENT_ID": "your-client-id",
        "GOOGLE_CLIENT_SECRET": "your-client-secret"
      }
    }
  }
}
```

The server starts automatically when your MCP client needs it.

### Remote Deployment (Cloud Run)

Deploy once for your team -- no local installs required. The server uses MCP OAuth 2.1 so your MCP client handles authentication automatically.

```bash
gcloud run deploy google-docs-mcp \
  --source . \
  --region europe-west3 \
  --port 8080 \
  --allow-unauthenticated \
  --set-env-vars "^|^MCP_TRANSPORT=httpStream|BASE_URL=https://your-service.run.app|GOOGLE_CLIENT_ID=...|GOOGLE_CLIENT_SECRET=...|TOKEN_STORE=firestore|JWT_SIGNING_KEY=your-secret-key"
```

Then each user just adds the URL to their MCP client -- no npx, no tokens, no local setup:

```json
{
  "mcpServers": {
    "google-docs": {
      "type": "streamableHttp",
      "url": "https://your-service.run.app/mcp"
    }
  }
}
```

Your MCP client will prompt for Google sign-in on first connection. See [Remote Deployment](#remote-deployment) for details.

---

## What Can It Do?

Tools across Google Docs, Sheets, and Drive:

### Google Docs

| Tool                          | Description                                       |
| ----------------------------- | ------------------------------------------------- |
| `readDocument`                | Read content as plain text, JSON, or markdown     |
| `appendText`                  | Append text to a document                         |
| `insertText`                  | Insert text at a specific position                |
| `deleteRange`                 | Remove content by index range                     |
| `modifyText`                  | Replace, prepend, or transform text in a document |
| `findAndReplace`              | Find and replace text across a document           |
| `listTabs`                    | List all tabs in a multi-tab document             |
| `addTab`                      | Add a new tab to a document                       |
| `renameTab`                   | Rename a document tab                             |
| `replaceDocumentWithMarkdown` | Replace entire document content from markdown     |
| `replaceRangeWithMarkdown`    | Replace a specific range with markdown content    |
| `appendMarkdown`              | Append markdown-formatted content                 |
| `applyTextStyle`              | Bold, italic, colors, font size, links            |
| `applyParagraphStyle`         | Alignment, spacing, indentation                   |
| `insertTable`                 | Create an empty table                             |
| `insertTableWithData`         | Create a table pre-filled with data               |
| `insertPageBreak`             | Insert page breaks                                |
| `insertSectionBreak`          | Insert section break (NEXT_PAGE or CONTINUOUS)    |
| `updateSectionStyle`          | Update section style: flip orientation, margins   |
| `insertImage`                 | Insert images from URLs or local files            |

### Comments

| Tool             | Description                            |
| ---------------- | -------------------------------------- |
| `listComments`   | View all comments with author and date |
| `getComment`     | Get a specific comment with replies    |
| `addComment`     | Create a comment anchored to text      |
| `replyToComment` | Reply to an existing comment           |
| `resolveComment` | Mark a comment as resolved             |
| `deleteComment`  | Remove a comment                       |

### Google Sheets

| Tool                          | Description                                                           |
| ----------------------------- | --------------------------------------------------------------------- |
| `readSpreadsheet`             | Read data from a range (A1 notation)                                  |
| `writeSpreadsheet`            | Write data to a range                                                 |
| `batchWrite`                  | Write to multiple ranges in one call                                  |
| `appendRows`                  | Add rows to a sheet                                                   |
| `clearRange`                  | Clear cell values                                                     |
| `createSpreadsheet`           | Create a new spreadsheet                                              |
| `addSheet`                    | Add a sheet/tab                                                       |
| `deleteSheet`                 | Remove a sheet/tab                                                    |
| `duplicateSheet`              | Duplicate a sheet within the same spreadsheet                         |
| `copySheetTo`                 | Copy a sheet into another spreadsheet                                 |
| `renameSheet`                 | Rename a sheet/tab                                                    |
| `getSpreadsheetInfo`          | Get metadata and sheet list                                           |
| `listSpreadsheets`            | Find spreadsheets                                                     |
| `formatCells`                 | Bold, colors, alignment, vertical alignment, wrap strategy on ranges  |
| `copyFormatting`              | Copy formatting from one range to another                             |
| `readCellFormat`              | Read formatting details of a cell range                               |
| `setCellBorders`              | Set per-side borders (top/bottom/left/right/inner) with style & color |
| `freezeRowsAndColumns`        | Pin header rows/columns                                               |
| `setDropdownValidation`       | Add/remove dropdown lists on cells                                    |
| `setColumnWidths`             | Set column widths in pixels                                           |
| `setRowHeights`               | Set row heights in pixels                                             |
| `autoResizeColumns`           | Auto-fit column widths to content                                     |
| `autoResizeRows`              | Auto-fit row heights to content                                       |
| `protectRange`                | Lock a range or entire sheet (warning-only or fully locked)           |
| `addConditionalFormatting`    | Add a conditional formatting rule                                     |
| `getConditionalFormatting`    | List conditional formatting rules with their index (JSON)             |
| `deleteConditionalFormatting` | Delete conditional formatting rules by index                          |
| `groupRows`                   | Group rows for collapsible sections                                   |
| `ungroupAllRows`              | Remove all row groupings                                              |
| `insertChart`                 | Create a chart from data                                              |
| `deleteChart`                 | Remove a chart                                                        |
| `extractSheetHyperlink`    | Resolve the hyperlink stored in a single cell |
| `followSheetHyperlink`     | Follow a cell hyperlink with HTTP GET |

### Google Sheets Tables

| Tool               | Description                                    |
| ------------------ | ---------------------------------------------- |
| `createTable`      | Create a new named table with column types     |
| `listTables`       | List all tables in a spreadsheet or sheet      |
| `getTable`         | Get detailed table metadata by name or ID      |
| `deleteTable`      | Delete a table (optionally clear data)         |
| `updateTableRange` | Modify table dimensions (add/remove rows/cols) |
| `appendTableRows`  | Append rows to a table (table-aware insertion) |

### Google Drive

| Tool                         | Description                                 |
| ---------------------------- | ------------------------------------------- |
| `listDocuments`              | List documents, optionally filtered by date |
| `searchDocuments`            | Search by name or content                   |
| `getDocumentInfo`            | Get document metadata                       |
| `createDocument`             | Create a new document                       |
| `createDocumentFromTemplate` | Create from an existing template            |
| `createFolder`               | Create a folder                             |
| `listFolderContents`         | List folder contents                        |
| `getFolderInfo`              | Get folder metadata                         |
| `moveFile`                   | Move a file to another folder               |
| `copyFile`                   | Duplicate a file                            |
| `renameFile`                 | Rename a file                               |
| `deleteFile`                 | Move to trash or permanently delete         |
| `listDriveFiles`             | List any file type in Drive with filters    |
| `searchDriveFiles`           | Search all Drive files by name or content   |
| `downloadFile`               | Download a file's content                   |

### Gmail

| Tool                  | Description                                                                                                                 |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `listMessages`        | List or search messages using Gmail query syntax (`is:unread`, `from:`, `newer_than:`, etc.)                                |
| `getMessage`          | Fetch a single message with decoded headers, plain-text body, HTML body, and attachment metadata                            |
| `sendEmail`           | Send a plain-text email. Supports cc/bcc and threaded replies via `replyToMessageId`                                        |
| `trashMessage`        | Move a message to Trash (reversible, same as clicking Delete in the Gmail UI)                                               |
| `modifyMessageLabels` | Add or remove labels on a message — use to star, archive (remove `INBOX`), mark read (remove `UNREAD`)                      |
| `listLabels`          | List all system and custom labels with their IDs                                                                            |
| `createDraft`         | Compose a draft instead of sending immediately — for compose/review/send workflows                                          |
| `listDrafts`          | List existing drafts with recipient, subject, and snippet                                                                   |
| `getDraft`            | Fetch a single draft with full headers and body                                                                             |
| `updateDraft`         | Replace the contents of an existing draft (full replace, not patch)                                                         |
| `sendDraft`           | Send an existing draft by ID                                                                                                |
| `deleteDraft`         | Permanently delete a draft (not moved to Trash — gone)                                                                      |
| `triageInbox`         | **Composite:** fetch unread messages with content + heuristic flags (newsletter, meeting, action) for one-shot inbox triage |

### Google Calendar

| Tool            | Description                                                                                        |
| --------------- | -------------------------------------------------------------------------------------------------- |
| `listEvents`    | List or search events with `q`, `timeMin`, `timeMax`, `maxResults` (defaults to primary calendar)  |
| `createEvent`   | Create an event with title, start/end, description, location, attendees, optional Google Meet link |
| `updateEvent`   | PATCH-style update — only the fields you pass change. Use to reschedule, retitle, change attendees |
| `deleteEvent`   | Permanently delete an event. Optional `sendUpdates` emails cancellations to attendees              |
| `quickAddEvent` | Natural-language event creation: `"Lunch with Sarah tomorrow 12pm"` — Google parses the rest       |

---

## Usage Examples

### Google Docs

```
"Read document ABC123 as markdown"
"Append 'Meeting notes for today' to document ABC123"
"Make the text 'Important' bold and red in document ABC123"
"Replace the entire document with this markdown: # Title\n\nNew content here"
"Insert a 3x4 table at index 50 in document ABC123"
```

### Google Sheets

```
"Read range A1:D10 from spreadsheet XYZ789"
"Write [[Name, Score], [Alice, 95], [Bob, 87]] to range A1 in spreadsheet XYZ789"
"Create a new spreadsheet titled 'Q1 Report'"
"Format row 1 as bold with a light blue background in spreadsheet XYZ789"
"Freeze the first row in spreadsheet XYZ789"
"Add a dropdown with options [Open, In Progress, Done] to range C2:C100"
"Create a table named 'Tasks' in range A1:D10 with columns: Task (TEXT), Status (DROPDOWN: 'Not Started','In Progress','Done'), Priority (NUMBER)"
"Add a medium solid border around A1:D10 in spreadsheet XYZ789"
"Protect the header row so collaborators can't accidentally edit it"
"Auto-fit row heights for rows 2–50 after wrapping text"
```

### Google Drive

```
"List my 10 most recent Google Docs"
"Search for documents containing 'project proposal'"
"Create a folder called 'Meeting Notes' and move document ABC123 into it"
```

### Gmail

```
"Show me my 20 most recent unread emails"
"Search Gmail for messages from alice@example.com in the last 7 days"
"Read the full body of message ID 18c3f4a2b1d9"
"Send an email to bob@example.com with the subject 'Weekly update' and this body..."
"Reply to message 18c3f4a2b1d9 with 'Thanks, confirmed.'"
"Star message 18c3f4a2b1d9 and archive it"
"Move message 18c3f4a2b1d9 to Trash"
"List all my Gmail labels"
"Draft a reply to that email but don't send it yet — let me review first"
"Show me my drafts, then send the one to bob@"
"Triage my unread inbox: tell me which 20 emails need attention and which are noise"
```

### Google Calendar

```
"What's on my calendar this week?"
"Create an event titled 'Project review' tomorrow from 2pm to 3pm Pacific time"
"Quick add: lunch with Alex Friday 12:30"
"Reschedule event abc123 to next Monday at 10am"
"Delete the 'Standup' event tomorrow"
"List all events on my calendar between April 15 and April 22"
"Schedule a 30-minute meeting with bob@example.com next Wednesday at 11am with a Google Meet link"
```

### Markdown Workflow

The server supports a full round-trip markdown workflow:

1. Read a document as markdown: `readDocument` with `format='markdown'`
2. Edit the markdown locally
3. Push changes back: `replaceDocumentWithMarkdown`

Supported: headings, bold, italic, strikethrough, links, bullet/numbered lists, horizontal rules.

### Live Docs Verification

The repository includes an opt-in live integration test for `cloneTable` against the real Google Docs API. It is skipped by default.

Requirements:

- valid `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`
- an authorized token already stored via `npx -y @a-bonus/google-docs-mcp auth`

Run it with:

```bash
GOOGLE_DOCS_LIVE_TESTS=1 npm run test:live:docs
```

This test creates temporary source/target Google Docs, verifies `cloneTable`, and then deletes the test files.

---

## Remote Deployment

Deploy the server centrally on Google Cloud Run (or any container host) so your team can use it without local installs. The server uses **MCP OAuth 2.1** with FastMCP's built-in `GoogleProvider` -- MCP clients handle the auth flow automatically.

Visit the server root URL (`/`) for setup instructions and a ready-to-copy client config.

### Environment Variables

| Variable               | Description                                                              |
| ---------------------- | ------------------------------------------------------------------------ |
| `MCP_TRANSPORT`        | Set to `httpStream` to enable remote mode (default: `stdio`)             |
| `BASE_URL`             | Public URL of the deployed server (required for OAuth redirects)         |
| `GOOGLE_CLIENT_ID`     | OAuth client ID (Web application type)                                   |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret                                                      |
| `ALLOWED_DOMAINS`      | Comma-separated list of allowed Google Workspace domains (optional)      |
| `PORT`                 | HTTP port (default: `8080`)                                              |
| `TOKEN_STORE`          | Set to `firestore` for persistent token storage (default: in-memory)     |
| `JWT_SIGNING_KEY`      | Fixed signing key so tokens survive restarts (auto-generated if not set) |
| `REFRESH_TOKEN_TTL`    | Refresh token lifetime in seconds (default: `2592000` / 30 days)         |
| `GCLOUD_PROJECT`       | GCP project ID for Firestore (required when `TOKEN_STORE=firestore`)     |

### Setup

1. Create a GCP project and enable Docs, Sheets, and Drive APIs
2. Create an OAuth client (**Web application** type, not Desktop)
3. Set the authorized redirect URI to `{BASE_URL}/oauth/callback`
4. Deploy to Cloud Run:

```bash
gcloud run deploy google-docs-mcp \
  --source . \
  --region europe-west3 \
  --port 8080 \
  --allow-unauthenticated \
  --set-env-vars "^|^MCP_TRANSPORT=httpStream|BASE_URL=https://your-service.run.app|ALLOWED_DOMAINS=yourdomain.com|GOOGLE_CLIENT_ID=...|GOOGLE_CLIENT_SECRET=...|TOKEN_STORE=firestore|JWT_SIGNING_KEY=your-secret-key"
```

> **Note:** The `^|^` prefix changes the env var delimiter from `,` to `|` because `ALLOWED_DOMAINS` contains commas.

### How It Works

- By default, OAuth sessions are stored in memory and lost on restart
- For production, set `TOKEN_STORE=firestore` and `JWT_SIGNING_KEY` for persistent auth across deploys and cold starts
- `ALLOWED_DOMAINS` restricts access to specific Google Workspace domains
- Access tokens refresh automatically; inactive sessions expire after 30 days
- Users can revoke access at any time via [Google Account permissions](https://myaccount.google.com/permissions)

### Updating Your Deployment

Merging changes to `main` does **not** automatically update your Cloud Run service. Each deployment is independent — you need to redeploy manually when you want new features or fixes.

**To update:**

1. Pull the latest code:

   ```bash
   git pull origin main
   ```

2. Redeploy to Cloud Run:
   ```bash
   gcloud run deploy your-service-name --source . --region your-region
   ```
   Your existing environment variables are preserved — no need to pass `--set-env-vars` again.

**When to redeploy:**

- **Bug fixes and security patches** — redeploy as soon as possible
- **New features** — redeploy at your convenience
- **Breaking changes** — check the release notes before redeploying

You can check your current version against the latest release on the [releases page](https://github.com/a-bonus/google-docs-mcp/releases).

---

## Authentication Options

### OAuth (Default)

Pass your Google Cloud OAuth client credentials as environment variables:

| Variable               | Description                                   |
| ---------------------- | --------------------------------------------- |
| `GOOGLE_CLIENT_ID`     | OAuth client ID from Google Cloud Console     |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret from Google Cloud Console |

### Service Account (Enterprise)

For Google Workspace with domain-wide delegation:

| Variable                  | Description                                 |
| ------------------------- | ------------------------------------------- |
| `SERVICE_ACCOUNT_PATH`    | Path to the service account JSON key file   |
| `GOOGLE_IMPERSONATE_USER` | Email of the user to impersonate (optional) |

```json
{
  "mcpServers": {
    "google-docs": {
      "command": "npx",
      "args": ["-y", "@a-bonus/google-docs-mcp"],
      "env": {
        "SERVICE_ACCOUNT_PATH": "/path/to/service-account-key.json",
        "GOOGLE_IMPERSONATE_USER": "user@yourdomain.com"
      }
    }
  }
}
```

### Token Storage

OAuth refresh tokens are stored in `~/.config/google-docs-mcp/token.json` (respects `XDG_CONFIG_HOME`). To re-authorize, run the `auth` command again or delete the token file.

### Multiple Google Accounts

Set `GOOGLE_MCP_PROFILE` to store tokens in a profile-specific subdirectory. This allows using different Google accounts for different projects:

| Variable             | Description                                        |
| -------------------- | -------------------------------------------------- |
| `GOOGLE_MCP_PROFILE` | Profile name for isolated token storage (optional) |

```json
{
  "mcpServers": {
    "google-docs": {
      "command": "npx",
      "args": ["-y", "@a-bonus/google-docs-mcp"],
      "env": {
        "GOOGLE_CLIENT_ID": "...",
        "GOOGLE_CLIENT_SECRET": "...",
        "GOOGLE_MCP_PROFILE": "work"
      }
    }
  }
}
```

Tokens are stored per profile:

```
~/.config/google-docs-mcp/
├── token.json              # default (no profile)
├── work/token.json         # GOOGLE_MCP_PROFILE=work
├── personal/token.json     # GOOGLE_MCP_PROFILE=personal
```

Without `GOOGLE_MCP_PROFILE`, behavior is unchanged.

---

## Known Limitations

- **Comment anchoring:** Programmatically created comments appear in the comment list but aren't visibly anchored to text in the Google Docs UI. This is a Google Drive API limitation.
- **Comment resolution:** Resolved status may not persist in the Google Docs UI.
- **Converted documents:** Docs converted from Word may not support all API operations.
- **Markdown tables/images:** Not yet supported in the markdown-to-Docs conversion.
- **Deeply nested lists:** Lists with 3+ nesting levels may have formatting quirks.
- **Gmail hard delete:** `trashMessage` moves messages to Trash (reversible). Permanent deletion requires the broader `https://mail.google.com/` scope and is not exposed in v0.1.
- **Gmail attachments:** `getMessage` returns attachment metadata but does not download attachment bytes yet.
- **Gmail HTML email send:** `sendEmail` sends plain-text only. For HTML bodies, paste HTML into the `body` field — it will be delivered as text, not rendered.
- **Calendar scope:** `calendar.events` permits event CRUD on existing calendars but cannot create or delete entire calendars themselves.
- **Calendar recurring events:** `updateEvent` and `deleteEvent` modify the entire recurring series unless you target a specific instance ID returned by `listEvents` with `singleEvents=true`.

## Troubleshooting

- **Server won't start:**
  - Verify `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set in the `env` block of your MCP config.
  - Try running manually: `npx @a-bonus/google-docs-mcp` and check stderr for errors.
- **Authorization errors:**
  - Ensure Docs, Sheets, Drive, Gmail, and Calendar APIs are enabled in Google Cloud Console.
  - Confirm your email is listed as a Test User on the OAuth consent screen and that all required scopes (Docs, Sheets, Drive, `gmail.modify`, `calendar.events`) are added to the consent screen.
  - Re-authorize: `npx @a-bonus/google-docs-mcp auth`
  - Delete `~/.config/google-docs-mcp/token.json` and re-authorize if upgrading — Gmail and Calendar scopes were added in later versions, so existing tokens must be refreshed.
  - Remote (Cloud Run) users must sign out and sign back in from their MCP client so Google reissues consent with the new scope list.
- **Tab errors:**
  - Use `listTabs` to see available tab IDs.
  - Omit `tabId` for single-tab documents.
- **"Page not found" on claude.ai during OAuth sign-in (remote deployments):**
  - Symptom: clicking Connect on a custom MCP connector lands on the Claude "Page not found" page instead of the Google sign-in screen.
  - Cause: Cloud Run cold start. The first request to an idle service times out before the container finishes spinning up, and Claude routes the failed redirect to its 404 page.
  - Workaround: hard-refresh the page (`Cmd+Shift+R` on macOS, `Ctrl+Shift+R` on Windows/Linux). The second request hits a now-warm instance and the OAuth flow proceeds normally.
  - Permanent fix: set `--min-instances=1` on your Cloud Run service to keep one instance always warm (`gcloud run services update <service> --region <region> --min-instances=1`). Costs ~$2–3/month for the memory reservation.
- **Re-authenticated unexpectedly after a redeploy (remote deployments):**
  - Cause: `JWT_SIGNING_KEY` is auto-generated on each container start, so redeploys invalidate all previously issued sessions.
  - Fix: set a stable `JWT_SIGNING_KEY` env var on the Cloud Run service so it survives restarts: `gcloud run services update <service> --region <region> --update-env-vars JWT_SIGNING_KEY=$(openssl rand -hex 32)`. Sessions minted after this change will survive future redeploys.
- **High CPU with multiple MCP sessions:** Some clients call `tools/list` very often. FastMCP otherwise recomputes JSON Schema for every tool on every request, which can pin a CPU core per process. This server precomputes the payload once before stdio starts and replaces the `tools/list` handler with a cached snapshot. If you still see sustained load, capture a few seconds with `sample <pid> 1 10` (macOS) or `node --cpu-prof` and report it.

---

## Google Cloud Setup Details

<details>
<summary>Step-by-step Google Cloud Console instructions</summary>

> For **remote deployment**, create an OAuth client of type **Web application** (not Desktop app). Use Desktop app only for local stdio usage.

1. **Go to Google Cloud Console:** Open [console.cloud.google.com](https://console.cloud.google.com/)
2. **Create or Select a Project:** Click the project dropdown > "NEW PROJECT". Name it (e.g., "MCP Docs Server") and click "CREATE".
3. **Enable APIs:**
   - Navigate to "APIs & Services" > "Library"
   - Search for and enable: **Google Docs API**, **Google Sheets API**, **Google Drive API**, **Gmail API**, **Google Calendar API**
4. **Configure OAuth Consent Screen:**
   - Go to "APIs & Services" > "OAuth consent screen"
   - Choose "External" and click "CREATE"
   - Fill in: App name, User support email, Developer contact email
   - Click "SAVE AND CONTINUE"
   - Add scopes: `documents`, `spreadsheets`, `drive`, `gmail.modify`, `calendar.events`
   - Click "SAVE AND CONTINUE"
   - Add your Google email as a Test User
   - Click "SAVE AND CONTINUE"
5. **Create Credentials:**
   - Go to "APIs & Services" > "Credentials"
   - Click "+ CREATE CREDENTIALS" > "OAuth client ID"
   - Application type: "Desktop app"
   - Click "CREATE"
   - Copy the **Client ID** and **Client Secret**

</details>

---

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, architecture overview, and guidelines.

## License

MIT -- see [LICENSE](LICENSE) for details.

# Contributing

Thanks for your interest in contributing! This guide covers how to set up the project for local development, understand the architecture, and submit changes.

## Development Setup

### Prerequisites

- Node.js 20+ ([nodejs.org](https://nodejs.org/))
- Git ([git-scm.com](https://git-scm.com/downloads))
- A Google Account with access to test documents

### Clone and Build

```bash
git clone https://github.com/a-bonus/google-docs-mcp.git
cd google-docs-mcp
npm install
npm run build
```

### Authenticate

You need Google OAuth credentials to test the server against real APIs.

**Option A: credentials.json file**

1. Download your OAuth client JSON from [Google Cloud Console](https://console.cloud.google.com/)
2. Rename it to `credentials.json` and place it in the project root
3. Run `npm start auth` to open the browser-based OAuth flow

**Option B: Environment variables**

```bash
GOOGLE_CLIENT_ID="your-client-id" \
GOOGLE_CLIENT_SECRET="your-client-secret" \
npm start auth
```

Both options save the refresh token to `~/.config/google-docs-mcp/token.json`. OAuth client IDs and client secrets stay in your environment or `credentials.json`; they are not stored in the token file.

### Register Your Local Build

Point your MCP client at the local build for testing:

```json
{
  "mcpServers": {
    "google-docs": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-googledocs-server/dist/index.js"]
    }
  }
}
```

### Scripts

| Command                | Description                    |
| ---------------------- | ------------------------------ |
| `npm start`            | Start the MCP server           |
| `npm start auth`       | Run the interactive OAuth flow |
| `npm run build`        | Compile TypeScript to `dist/`  |
| `npm test`             | Run tests (Vitest)             |
| `npm run format`       | Format code with Prettier      |
| `npm run format:check` | Check formatting               |

---

## Project Architecture

### Entry Points

```
src/index.ts        Entry point: CLI (auth subcommand) and MCP server startup
src/auth.ts         OAuth / service account authentication
src/clients.ts      Google API client singletons (Docs, Drive, Sheets)
```

### Tools

Tools live in `src/tools/`, organized by domain. Each tool is a single file exporting a `register(server: FastMCP)` function.

```
src/tools/
├── index.ts            Top-level router
├── docs/               Google Docs tools (13)
│   ├── comments/       Comment management (6)
│   └── formatting/     Text and paragraph styling (2)
├── drive/              Google Drive tools (15)
├── sheets/             Google Sheets tools (37)
├── gmail/              Gmail tools (13)
├── calendar/           Google Calendar tools (5)
└── utils/              Cross-cutting utilities (3)
```

### Helpers

| File                            | Purpose                                                            |
| ------------------------------- | ------------------------------------------------------------------ |
| `src/googleDocsApiHelpers.ts`   | Text range finding, batch update execution, style request builders |
| `src/googleSheetsApiHelpers.ts` | A1 notation parsing, cell formatting, freeze, validation           |
| `src/markdown-transformer/`     | Markdown parsing and bidirectional Google Docs conversion          |
| `src/types.ts`                  | Zod schemas, hex color validation, shared type definitions         |
| `src/logger.ts`                 | Leveled logger (debug/info/warn/error) writing to stderr           |

### Authentication Flow

The auth module (`src/auth.ts`) resolves credentials in this order:

1. `SERVICE_ACCOUNT_PATH` env var -- service account JWT
2. `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` env vars -- OAuth (for `npx` consumers)
3. `credentials.json` in the project root -- OAuth (for local dev)

Tokens are persisted to `~/.config/google-docs-mcp/token.json` (respects `XDG_CONFIG_HOME`). The token file stores OAuth token credentials only, not OAuth client IDs or client secrets.

---

## Adding a New Tool

1. Create a new file in the appropriate domain folder (e.g., `src/tools/sheets/myNewTool.ts`)
2. Export a `register(server: FastMCP)` function that calls `server.addTool({...})`
3. Import and call it from the domain's `index.ts` router
4. Add tests if the tool involves non-trivial logic

### Tool Conventions

- **Names:** camelCase, verb-first (e.g., `readDocument`, `formatCells`)
- **Descriptions:** Start with what the tool does, mention when to use it, note any caveats
- **Parameters:** Use Zod schemas with `.describe()` on every field
- **Errors:** Throw `UserError` from `fastmcp` for user-facing errors
- **Output:** Return `JSON.stringify`'d structured data for tools that return actionable information

---

## Testing

Tests use [Vitest](https://vitest.dev/) and live alongside source files or in `src/`:

```bash
npm test              # Run all tests
npm test -- --watch   # Watch mode
```

Tests mock Google API clients -- they don't make real API calls.

---

## Code Style

- TypeScript with strict mode
- ESM modules (`.js` extensions in imports)
- Prettier for formatting (`npm run format`)
- All log output goes to stderr (stdout is reserved for MCP protocol)

---

## Releasing

Releases are automated via GitHub Actions. To publish a new version:

1. Update the version in `package.json`
2. Commit and push to `main`
3. Tag the commit: `git tag v1.2.3 && git push origin v1.2.3`
4. The [release workflow](.github/workflows/release.yml) will run CI checks, publish to npm, and create a GitHub Release

The npm package is published as `@a-bonus/google-docs-mcp`.

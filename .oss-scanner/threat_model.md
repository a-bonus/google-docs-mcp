# Threat model: google-docs-mcp

## What this project does

An MCP (Model Context Protocol) server, written in TypeScript on FastMCP, that gives an AI agent
about 100 tools over a user's Google Docs, Sheets, Drive, Gmail, Calendar and Apps Script. It runs
in two modes:

- **stdio (default, `npx @a-bonus/google-docs-mcp`)**: a local process started by an MCP client
  (Claude Desktop, Claude Code, Cursor). It authenticates once through a browser OAuth flow and
  keeps the Google token in `~/.config/google-docs-mcp/token.json` (or under `XDG_CONFIG_HOME`, per
  `GOOGLE_MCP_PROFILE`). A service account (`SERVICE_ACCOUNT_PATH`, optional
  `GOOGLE_IMPERSONATE_USER`) is also supported. The process has the user's filesystem permissions.
- **remote (`MCP_TRANSPORT=httpStream`)**: a multi-user HTTP server (`src/index.ts`) that acts as an
  MCP OAuth 2.1 authorization server, proxying to Google (`OAuthProxy` from FastMCP), with tokens
  optionally stored in Firestore (`src/firestoreTokenStorage.ts`). Each request gets its own Google
  clients (`src/remoteWrapper.ts`). `ALLOWED_DOMAINS` restricts sign-in to Google Workspace domains.
  Also serves a landing page (`src/landingPage.ts`) and short-lived download links
  (`src/downloadProxy.ts`, `/download/:token`).

## Who the attacker is and where untrusted input enters

The main attacker is **someone who controls content the agent reads**, not the user who runs the
server. The agent routinely reads documents, sheets, emails, calendar invites, comments and file
names written by other people. Through indirect prompt injection that content can choose the
arguments of any tool call. Treat every tool argument as attacker-controlled, including file IDs,
paths, URLs, ranges, markdown, email addresses and Apps Script source.

Other untrusted input:

- Data returned by Google APIs (document JSON, sheet values, Gmail MIME parts and headers, Drive
  metadata and file names) when it is parsed, converted (`src/markdown-transformer/`), or echoed
  into HTML, HTTP headers or the local filesystem.
- In remote mode, unauthenticated HTTP clients: the OAuth endpoints (authorize, token, dynamic client
  registration, callback), `/download/:token`, the landing page and `/mcp` itself. Also authenticated
  users who must not reach each other's tokens, sessions or downloads.

Trusted: the operator's environment variables and config files, the Google APIs themselves, and the
MCP client in stdio mode (it can already run anything as the user).

## Components that matter most

1. **Local filesystem boundaries (stdio)**. A tool argument must never read or write files outside
   the directories the operator allowed. Today's guards:
   - `src/tools/drive/savePathGuard.ts`: `downloadFile` writes only inside
     `GOOGLE_DOCS_MCP_DOWNLOAD_ROOTS` (default: working directory), with symlinks resolved.
   - `src/tools/gmail/attachmentGuard.ts`: `createDraft` / `updateDraft` attach only files inside
     `GMAIL_ATTACHMENT_ROOTS`; unset means refused.
   - Anything else that reads a local path and sends its bytes to Google (e.g. `insertImage` with `localImagePath`,
     `uploadImageToDrive` in `src/googleDocsApiHelpers.ts`) is an exfiltration path and in scope.
     Bypasses (traversal, symlink races, `..` after canonicalization, case or Unicode tricks, Windows
     separators) are high.
2. **Remote-mode authentication and isolation**: `src/index.ts`, `src/remoteWrapper.ts`,
   `src/upstreamAuth.ts`, `src/firestoreTokenStorage.ts`. Token theft or confusion between users,
   OAuth redirect-URI validation (`allowedRedirectUriPatterns`), the `ALLOWED_DOMAINS` check (it
   reads `hd` from the ID token), PKCE/state handling, token TTLs, and any way to call a tool without
   a valid session.
3. **Download proxy** (`src/downloadProxy.ts`): token guessability, reuse, expiry, cross-user access,
   and header injection through the file name in `Content-Disposition`.
4. **Exfiltration and confused-deputy tool behavior**: tools that send data outside the user's
   account (`setFilePermission`, `sendEmail`, `sendDraft`, `insertImage` with `imageUrl`, Apps Script
   create/update) beyond what their parameters say they do, e.g. header injection in Gmail
   (`src/tools/gmail/`) that adds hidden recipients, or a share call that widens permissions further
   than requested.
5. **Local credentials**: `src/auth.ts` token and credentials file handling (file permissions, path
   from `GOOGLE_MCP_PROFILE`, leaking tokens into logs or tool output via `src/logger.ts`).

## Less important / out of scope

- `src/backup/` (`*.bak`), `apps_script/`, `pages/`, `docs/`, `assets/` and `repomix-output.txt.xml`
  are not shipped and are out of scope.
- That the agent _can_ perform a destructive action the user granted it (delete a doc, trash an
  email) is the product working as designed. A report must show a tool doing more than its
  parameters describe, or escaping a boundary listed above.
- Prompt injection itself (content convincing the model to call a tool) is not a bug in this
  project. Reports should show what an injected call can reach that it should not.
- Denial of service against a local stdio process, and Google API quota exhaustion.
- Findings that need control of the operator's environment variables or config files.
- Vulnerabilities in `fastmcp`, `googleapis` or other dependencies, unless this project uses them
  unsafely. Report the upstream issue separately.

## How to exercise it

- `npm test` runs the vitest unit tests offline. Tests sit next to the code (`*.test.ts`); the
  path guards have focused tests (`savePathGuard.test.ts`, `attachmentGuard.test.ts`,
  `downloadProxy.test.ts`, `upstreamAuth.test.ts`, `auth.test.ts`).
- `*.live.test.ts` need real Google credentials and are skipped without `GOOGLE_DOCS_LIVE_TESTS`.
- Tool handlers live in `src/tools/<group>/<tool>.ts`. They can be called directly with mocked
  Google clients, as the existing tests do. Use `npx tsx` for one-off reproducers.
- Remote mode starts with `MCP_TRANSPORT=httpStream BASE_URL=http://localhost:8080
GOOGLE_CLIENT_ID=x GOOGLE_CLIENT_SECRET=y node dist/index.js`. The OAuth and download routes can
  be exercised locally; Google itself is unreachable.

## How we rate severity

- **Critical**: in remote mode, unauthenticated access to another user's Google token or data, or
  tool execution without auth.
- **High**: one user reaching another user's data in remote mode; reading or writing arbitrary
  local files in stdio mode through tool arguments (escaping the configured roots); sending data to
  a recipient or URL the tool parameters did not name; leaking OAuth tokens into tool output, logs
  or responses.
- **Medium**: redirect-URI or `ALLOWED_DOMAINS` weaknesses that need user interaction; XSS or
  header injection on the landing page or download route; secrets written with loose file
  permissions.
- **Low**: info leaks of non-secret metadata, missing hardening with no demonstrated impact.

## Reports and patches

Include a minimal reproducer (a vitest test in the style of the existing `*.test.ts` files is
ideal) and a patch that keeps behavior for legitimate callers. Prefer extending the existing guard
modules over adding new one-off checks. Patches must pass `npm run format:check`,
`npx tsc --noEmit` and `npm test`.

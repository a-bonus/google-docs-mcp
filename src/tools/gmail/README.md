# Gmail

Tools for reading, drafting, sending, deleting, organizing, and triaging Gmail messages on the authenticated user's account. Uses the `gmail.modify` OAuth scope, which covers read, send, draft, label changes, and trash but **not** permanent message deletion.

## Messages

| Tool                        | Description                                                                                                |
| --------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `listMessages`              | Lists or searches messages using the full Gmail query syntax (e.g. `is:unread from:foo newer_than:7d`)     |
| `getMessage`                | Fetches a single message with decoded headers, plain-text body, HTML body, and attachment metadata         |
| `downloadMessageAttachment` | Saves one attachment of a message to a local file. See [Downloading attachments](#downloading-attachments) |
| `sendEmail`                 | Sends a plain-text email; supports cc/bcc and threaded replies via `replyToMessageId`. No attachments      |
| `trashMessage`              | Moves a message to Trash (reversible from the Gmail UI Trash folder for 30 days). Not a permanent delete   |
| `modifyMessageLabels`       | Adds and/or removes labels on a message — used for star, archive, mark read, and custom-label tagging      |
| `listLabels`                | Lists all system and user-created Gmail labels with their IDs, for use with the other tools                |

## Drafts (compose / review / send)

| Tool          | Description                                                                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `createDraft` | Creates a draft instead of sending. Use this when an AI composes an email the user should review                                                 |
| `listDrafts`  | Lists drafts with recipients, subject, and snippet                                                                                               |
| `getDraft`    | Fetches one draft with full headers, body, and attachment metadata                                                                               |
| `updateDraft` | Replaces a draft's contents (full replace, not patch), keeping its thread unless `replyToMessageId` names another. Use to iterate before sending |
| `sendDraft`   | Sends an existing draft by ID — pairs with `createDraft` for the compose-review-send loop                                                        |
| `deleteDraft` | Permanently deletes a draft. Not moved to Trash — gone                                                                                           |

`createDraft` also returns `from`, the address of the account the draft was created in.

## Attachments

`createDraft` and `updateDraft` take one extra parameter. `updateDraft` is a full replace, so pass `attachments` again or the draft loses them.

| Parameter     | Type       | Description                                                                                                                           |
| ------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `attachments` | `string[]` | Optional absolute paths of local files to attach. Each must resolve, after symlinks, to a regular file under `GMAIL_ATTACHMENT_ROOTS` |

A tool that reads local files and mails them is an exfiltration channel if a prompt-injected message can steer it, so the boundary is strict:

- Off until you opt in. Set `GMAIL_ATTACHMENT_ROOTS` in the server's `env` to absolute directories, delimited by `:` (`;` on Windows). While it is unset every attachment is refused. A root that contains your home directory (`/`, `/Users`, or the home folder itself) is refused as well, since it would expose `~/.ssh`. Point it at a folder that only holds files you mean to send.
- Each path goes through `realpath` before the check, so `../` and symlinks cannot leave a root. Directories, FIFOs, and missing files are rejected. A missing file and a file outside the roots get the same error, which never shows the resolved path, so the error cannot be used to probe the disk.
- 18,000,000 bytes combined per message, checked with `stat` before anything is read. Gmail refuses messages over 25 MB and base64 adds about a third.
- Messages with attachments go to Gmail's upload endpoint as `message/rfc822` (documented limit 35 MiB). The API reference gives no limit for the `raw` field in a JSON body, so plain-text messages keep using `raw` exactly as before.
- Content-Type comes from the extension: `png`, `jpg`/`jpeg`, `gif`, `webp`, `pdf`, `txt`, `csv`, `zip`. Anything else is `application/octet-stream`. Non-ASCII file names use RFC 2231 (`filename*=UTF-8''...`). Control characters in a file name become `_`.
- Logs record file names and sizes, never contents.
- `sendEmail` takes no attachments, because nothing reviews it before it goes out. `sendDraft` can still send an attachment draft immediately, so keep it behind your MCP client's approval prompt.
- Unavailable in remote (`httpStream`) mode, where a path would name a file on the shared server.

## Downloading attachments

`downloadMessageAttachment` saves one attachment to disk. Take `messageId` and `partId` from the `attachments` list that `getMessage` returns.

| Parameter      | Type      | Description                                                                                                                                        |
| -------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `messageId`    | `string`  | The message the attachment belongs to                                                                                                              |
| `partId`       | `string`  | Preferred. Gmail issues a new `attachmentId` on every fetch, so the tool looks the part up and downloads the ID Gmail issues for it at that moment |
| `attachmentId` | `string`  | Used only without `partId`. The file name and MIME type are then known only while the ID still matches                                             |
| `savePath`     | `string`  | Required. A file path, or a directory (existing, or ending in `/`) to save under the attachment's sanitized name                                   |
| `overwrite`    | `boolean` | Optional, default `false`. Without it an existing file is never replaced                                                                           |

It returns `savedTo`, `filename` (the name as saved), `mimeType`, `sizeBytes` and `markedAsDownloaded`. Attachment names and bytes come from the sender, and the agent calling the tool may be reading that same mail, so:

- `savePath` is required: the tool never picks a folder on its own. It must stay inside `GOOGLE_DOCS_MCP_DOWNLOAD_ROOTS` (default: the working directory), the boundary `downloadFile` uses, checked after symlinks are resolved and before anything else is touched. Errors do not echo resolved paths.
- No part of the path below the download root may be hidden (start with `.`) or contain invisible characters (some filesystems ignore those, so `\u200c.git` could reach `.git`). On Windows 8.3 short names (`GIT~1`), trailing dots or spaces, `:` streams, device names and UNC paths are refused too. So the bytes never land in `.git/hooks`, `.npmrc`, `.envrc` or `.vscode`.
- The sender's file name becomes one safe segment: separators, control, invisible and Windows-invalid characters become `_`; leading dots become `_`; trailing dots and spaces are dropped; device names get a `_` prefix; at most 200 bytes of UTF-8, extension kept.
- The file is written to a temp file next to the target and moved into place. Without `overwrite` the move fails if anything appeared at the target meanwhile. With `overwrite` the directory entry is replaced: a symlink is never followed, other hard links keep the old content, the old mode (such as an exec bit) is not kept, and a failed download leaves the old file intact. The parent folder is checked again before it is created and right before the write.
- Data that is not valid base64url, or over 50 MB (Gmail's limit for incoming mail), is refused and nothing is written. The size Gmail reports is checked before downloading.
- The file is tagged before it is moved into place, so it is never there untagged. It is marked as downloaded from the internet where the OS supports it (`com.apple.quarantine` on macOS, Mark of the Web on Windows), so opening an executable attachment warns first. This is best effort.
- No new OAuth scope: `gmail.modify` already covers reading attachments.
- Unavailable in remote (`httpStream`) mode, where a path would name a file on the shared server.

Known limits: the invisible-character rule also refuses some real names in `savePath`, such as emoji joined with a zero-width joiner or Persian text with a zero-width non-joiner; the attachment's own name is sanitized instead. If the server dies mid-write, a hidden `.<random>.download-part` file can be left next to the target. The Windows rules are unit-tested but have not been run on a real Windows machine. A sender still chooses the file name, so saving into a folder that tools scan (a project root) can add a file such as `Makefile` or `AGENTS.md`. Point `GOOGLE_DOCS_MCP_DOWNLOAD_ROOTS` at a dedicated downloads folder. A local process that can already write inside the root can still race the final move; Node has no `openat`, so the window is narrowed, not closed.

## Composite triage

| Tool          | Description                                                                                                                                                                                                                                                                                          |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `triageInbox` | One call returns N unread messages with full content + per-message heuristic flags (newsletter detection via `List-Unsubscribe`, meeting reference, contains question, action requested) PLUS aggregate stats (top senders, category breakdown). Designed for AI inbox triage in a single round-trip |

## Common label IDs

System labels you can pass to `modifyMessageLabels` and `listMessages.labelIds` without calling `listLabels` first:

- `INBOX`, `SENT`, `DRAFT`, `TRASH`, `SPAM`
- `UNREAD`, `STARRED`, `IMPORTANT`
- `CATEGORY_PERSONAL`, `CATEGORY_SOCIAL`, `CATEGORY_PROMOTIONS`, `CATEGORY_UPDATES`, `CATEGORY_FORUMS`

Custom labels (anything you created in the Gmail UI) have opaque IDs like `Label_1234567890` — fetch them with `listLabels`.

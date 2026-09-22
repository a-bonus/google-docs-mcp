// Path boundary for downloadFile's `savePath`.
//
// downloadFile runs on behalf of an AI agent that routinely reads untrusted
// content (Drive documents, exported text). Both `fileId` and `savePath` are
// therefore attacker-influenceable through indirect prompt injection, and in
// stdio mode `savePath` reaches fs.createWriteStream() directly — an arbitrary
// file write primitive (CWE-22 / CWE-73) if it is not constrained.
//
// v1.10.0 confined writes to the working directory with ensureWithinCwd();
// v1.11.0 dropped it. This restores the boundary, resolves symlinks so a
// symlinked directory cannot be used to escape, and makes the allowed roots
// configurable for people who legitimately save outside the working directory.

import fs from 'node:fs';
import path from 'node:path';

/**
 * Parses GOOGLE_DOCS_MCP_DOWNLOAD_ROOTS: a platform-delimited list of
 * directories that downloadFile may write to. Defaults to the working
 * directory, which is the v1.10.0 behavior.
 */
export function parseDownloadRoots(value?: string, cwd: string = process.cwd()): string[] {
  const raw = value ?? process.env.GOOGLE_DOCS_MCP_DOWNLOAD_ROOTS ?? '';
  const entries = raw
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => path.resolve(cwd, entry));

  return entries.length > 0 ? entries : [path.resolve(cwd)];
}

function isInside(child: string, parent: string): boolean {
  if (child === parent) return true;
  return child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);
}

/** Deepest ancestor of `target` that exists on disk, as a literal path. */
function nearestExistingAncestor(target: string): string {
  let current = target;
  for (;;) {
    if (fs.existsSync(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) return current;
    current = parent;
  }
}

/**
 * Canonicalizes a path that may not exist yet: resolves symlinks as far as the
 * filesystem allows, then re-appends the portion that has still to be created.
 *
 * Both the destination and the allowed roots go through this, so a root behind
 * a symlink (on macOS `/tmp` is a link to `/private/tmp`) compares correctly,
 * and a symlinked directory inside a root cannot redirect a write out of it.
 */
function canonicalize(target: string): string {
  const absolute = path.resolve(target);
  const ancestor = nearestExistingAncestor(absolute);
  let realAncestor: string;
  try {
    realAncestor = fs.realpathSync(ancestor);
  } catch {
    return absolute;
  }
  return path.resolve(realAncestor, path.relative(ancestor, absolute));
}

/**
 * Resolves `savePath` and throws if it would write outside the allowed roots.
 *
 * Comparison happens after symlinks are resolved on both sides, which rejects
 * `../` traversal and symlinked-directory escapes alike.
 *
 * @throws Error when the destination escapes every allowed root.
 */
export function ensureWithinDownloadRoots(savePath: string, roots: string[]): string {
  const resolved = path.resolve(savePath);
  const realTarget = canonicalize(resolved);
  const realRoots = roots.map((root) => canonicalize(root));

  if (!realRoots.some((root) => isInside(realTarget, root))) {
    throw new Error(
      `savePath must stay inside the allowed download directory. ` +
        `"${savePath}" resolves to "${realTarget}", which is outside ${realRoots
          .map((root) => `"${root}"`)
          .join(', ')}. ` +
        `Pass a path inside that directory, or set GOOGLE_DOCS_MCP_DOWNLOAD_ROOTS to allow another one.`
    );
  }

  return resolved;
}

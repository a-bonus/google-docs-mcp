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

const WINDOWS_DEVICE = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$)(\..*)?$/i;

/** Why one path segment is unsafe for untrusted content, or null when it is fine. */
function segmentProblem(segment: string, platform: NodeJS.Platform): string | null {
  // Some filesystems (HFS+) ignore these when they compare names, so
  // "\u200c.git" would land in the real ".git".
  if (/[\p{Cf}\p{Zl}\p{Zp}]/u.test(segment)) return 'contains an invisible character';
  if (segment.startsWith('.')) return 'is hidden (starts with ".")';
  if (platform === 'win32') {
    if (segment.includes(':')) return 'names an alternate data stream';
    if (/[. ]$/.test(segment)) return 'ends in a dot or space, which Windows drops';
    if (/~\d/.test(segment)) return 'looks like an 8.3 short name';
    if (WINDOWS_DEVICE.test(segment)) return 'is a Windows device name';
  }
  return null;
}

/**
 * First unsafe path segment below the deepest matching root, or null.
 *
 * Hidden files and folders hold config that tools load or execute (`.git/hooks`,
 * `.npmrc`, `.envrc`, `.vscode`), so a writer of untrusted content refuses
 * them, along with names a filesystem may silently map onto one (invisible
 * characters; on Windows 8.3 short names, trailing dots, streams, devices).
 * Segments of the root itself are not checked, so a root may live inside a
 * hidden folder. The deepest root wins, so nested roots give one answer
 * whatever their order.
 */
export function unsafeSegmentBelowRoot(
  savePath: string,
  roots: string[],
  platform: NodeJS.Platform = process.platform
): { segment: string; problem: string } | null {
  const literalTarget = path.resolve(savePath);
  const realTarget = canonicalize(literalTarget);
  const deepest = (target: string, candidates: string[]) =>
    candidates.filter((r) => isInside(target, r)).sort((a, b) => b.length - a.length)[0];

  // Check the segments after symlinks are resolved (a link named "docs" may
  // point at ".git") and as written (realpath may already have mapped a name
  // the filesystem treats as equal onto the real one).
  const realRoot = deepest(
    realTarget,
    roots.map((r) => canonicalize(r))
  );
  if (realRoot === undefined) return null;
  const literalRoot = deepest(
    literalTarget,
    roots.map((r) => path.resolve(r))
  );
  const tails = [path.relative(realRoot, realTarget)];
  if (literalRoot !== undefined) tails.push(path.relative(literalRoot, literalTarget));

  for (const tail of tails) {
    for (const segment of tail.split(path.sep).filter(Boolean)) {
      const problem = segmentProblem(segment, platform);
      if (problem) return { segment, problem };
    }
  }
  return null;
}

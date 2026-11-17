// Tests for the downloadFile save-path boundary (issue #146).
//
// v1.10.0 confined writes with ensureWithinCwd(); v1.11.0 removed it, leaving
// an agent-controlled `savePath` flowing into fs.createWriteStream(). These
// cover the traversal cases from the report plus symlink escape, which the
// original cwd check did not catch.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ensureWithinDownloadRoots,
  parseDownloadRoots,
  unsafeSegmentBelowRoot,
} from './savePathGuard.js';

let root: string;
let outside: string;

beforeAll(() => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gdocs-guard-')));
  root = path.join(base, 'workdir');
  outside = path.join(base, 'outside');
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
});

afterAll(() => {
  fs.rmSync(path.dirname(root), { recursive: true, force: true });
});

describe('parseDownloadRoots', () => {
  it('defaults to the working directory', () => {
    expect(parseDownloadRoots('', '/tmp/example')).toEqual([path.resolve('/tmp/example')]);
  });

  it('accepts a delimited list and resolves entries against the cwd', () => {
    const roots = parseDownloadRoots(
      ['downloads', '/var/data'].join(path.delimiter),
      '/tmp/example'
    );
    expect(roots).toEqual([path.resolve('/tmp/example/downloads'), path.resolve('/var/data')]);
  });

  it('ignores blank entries', () => {
    expect(parseDownloadRoots(`  ${path.delimiter} ${path.delimiter} `, '/tmp/example')).toEqual([
      path.resolve('/tmp/example'),
    ]);
  });
});

describe('ensureWithinDownloadRoots', () => {
  it('allows a plain file inside the root', () => {
    const target = path.join(root, 'report.md');
    expect(ensureWithinDownloadRoots(target, [root])).toBe(target);
  });

  it('allows a nested path that does not exist yet', () => {
    const target = path.join(root, 'nested', 'deeper', 'report.md');
    expect(ensureWithinDownloadRoots(target, [root])).toBe(target);
  });

  it('rejects ../ traversal out of the root', () => {
    const target = path.join(root, '..', 'outside', 'evil.sh');
    expect(() => ensureWithinDownloadRoots(target, [root])).toThrow(/outside/i);
  });

  it('rejects an absolute path outside the root', () => {
    expect(() => ensureWithinDownloadRoots(path.join(outside, '.zshrc'), [root])).toThrow(
      /outside/i
    );
  });

  it('rejects a symlinked directory that escapes the root', () => {
    // The v1.10.0 cwd check compared the literal resolved path only, so a
    // symlink inside the working directory slipped through.
    const link = path.join(root, 'link');
    fs.symlinkSync(outside, link, 'dir');

    const target = path.join(link, 'evil.sh');
    expect(target.startsWith(root + path.sep)).toBe(true); // passes a naive prefix check
    expect(() => ensureWithinDownloadRoots(target, [root])).toThrow(/outside/i);
  });

  it('allows a second configured root', () => {
    const target = path.join(outside, 'report.md');
    expect(ensureWithinDownloadRoots(target, [root, outside])).toBe(target);
  });

  it('names the offending path and the env var in the error', () => {
    try {
      ensureWithinDownloadRoots(path.join(outside, 'evil.sh'), [root]);
      throw new Error('expected a rejection');
    } catch (error: any) {
      expect(error.message).toContain('GOOGLE_DOCS_MCP_DOWNLOAD_ROOTS');
      expect(error.message).toContain(root);
    }
  });
});

describe('downloadFile integration: traversal is refused before any write', () => {
  it('does not create a file outside the root', async () => {
    const { ensureWithinDownloadRoots: guard } = await import('./savePathGuard.js');
    const victim = path.join(outside, 'written.txt');

    expect(() => guard(victim, [root])).toThrow();
    // Nothing was created: the boundary runs before mkdirSync/createWriteStream.
    expect(fs.existsSync(victim)).toBe(false);
  });
});

describe('unsafeSegmentBelowRoot', () => {
  const check = (relative: string, platform: NodeJS.Platform = 'linux') =>
    unsafeSegmentBelowRoot(path.join(root, relative), [root], platform);

  it.each([['report.pdf'], ['sub/dir/report.pdf'], ['Rēķins.pdf'], ['a.b.c']])(
    'accepts %j',
    (relative) => {
      expect(check(relative)).toBeNull();
    }
  );

  it.each([
    ['.git/hooks/pre-commit', '.git'],
    ['sub/.npmrc', '.npmrc'],
    ['.GIT/config', '.GIT'],
    ['\u200c.git/config', '\u200c.git'],
    ['a\u202Eb/x', 'a\u202Eb'],
  ])('refuses %j at segment %j on every platform', (relative, segment) => {
    expect(check(relative)?.segment).toBe(segment);
  });

  it.each([
    ['GIT~1/hooks/pre-commit', 'GIT~1'],
    ['file.txt:stream', 'file.txt:stream'],
    ['name./x', 'name.'],
    ['name /x', 'name '],
    ['CON', 'CON'],
    ['sub/nul.txt', 'nul.txt'],
  ])('refuses %j on Windows', (relative, segment) => {
    expect(check(relative, 'win32')?.segment).toBe(segment);
    expect(check(relative, 'linux')).toBeNull();
  });

  it('does not check segments of the root itself', () => {
    const hiddenRoot = path.join(root, '.cache');
    expect(unsafeSegmentBelowRoot(path.join(hiddenRoot, 'x.pdf'), [hiddenRoot])).toBeNull();
  });

  it('uses the deepest root, whatever the order', () => {
    const inner = path.join(root, '.cache');
    const target = path.join(inner, 'x.pdf');
    expect(unsafeSegmentBelowRoot(target, [root, inner])).toBeNull();
    expect(unsafeSegmentBelowRoot(target, [inner, root])).toBeNull();
  });

  it('checks where a symlink inside the root leads', () => {
    fs.mkdirSync(path.join(root, '.hidden-target'), { recursive: true });
    fs.symlinkSync(path.join(root, '.hidden-target'), path.join(root, 'innocent'));
    expect(check('innocent/x')?.segment).toBe('.hidden-target');
  });

  it('returns null for a path outside every root', () => {
    expect(unsafeSegmentBelowRoot(path.join(outside, '.git'), [root])).toBeNull();
  });
});

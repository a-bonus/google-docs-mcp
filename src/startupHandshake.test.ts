// Regression test for the MCP spec-conformance reports in issues #157 and #158.
//
// Bug: src/index.ts authorized Google *before* server.start(), so a host could
// never complete the MCP `initialize` handshake when credentials were
// unavailable. Missing credentials threw and the startup catch called
// process.exit(1); a missing saved token sent authorize() into the interactive
// browser flow, which blocks on a local callback server. Conformance tooling
// reported "server exited" for version negotiation, official-SDK interop and
// three other requirements.
//
// The server must always answer `initialize`; authorization failures belong to
// the individual tool calls that need Google (getDocsClient() and friends
// already raise a UserError when the client cannot be built).
//
// This test spawns the built server with an empty HOME and no credentials.json,
// which is the exact environment the conformance runner used.

import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.resolve(here, '..', 'dist', 'index.js');

const INITIALIZE = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'conformance-regression', version: '1.0.0' },
  },
};

function initializeWithoutCredentials(timeoutMs = 20_000): Promise<any> {
  const emptyHome = mkdtempSync(path.join(tmpdir(), 'gdocs-mcp-home-'));
  const emptyCwd = mkdtempSync(path.join(tmpdir(), 'gdocs-mcp-cwd-'));

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry], {
      cwd: emptyCwd,
      env: {
        ...process.env,
        HOME: emptyHome,
        USERPROFILE: emptyHome,
        // Make sure no ambient configuration authorizes the server for us.
        GOOGLE_CLIENT_ID: '',
        GOOGLE_CLIENT_SECRET: '',
        SERVICE_ACCOUNT_PATH: '',
        MCP_TRANSPORT: '',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    const done = (fn: () => void) => {
      clearTimeout(timer);
      child.kill('SIGKILL');
      fn();
    };
    const timer = setTimeout(
      () => done(() => reject(new Error('Timed out waiting for the initialize response.'))),
      timeoutMs
    );

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      for (const line of stdout.split('\n')) {
        if (!line.trim()) continue;
        try {
          const message = JSON.parse(line);
          if (message.id === 1) return done(() => resolve(message));
        } catch {
          // Partial line; wait for more output.
        }
      }
    });

    child.on('exit', (code) =>
      done(() => reject(new Error(`Server exited with code ${code} before answering initialize.`)))
    );
    child.on('error', (error) => done(() => reject(error)));

    child.stdin.write(`${JSON.stringify(INITIALIZE)}\n`);
  });
}

describe.skipIf(!existsSync(entry))('MCP handshake without Google credentials', () => {
  it('completes initialize instead of exiting (issues #157, #158)', async () => {
    const response = await initializeWithoutCredentials();

    expect(response.error).toBeUndefined();
    expect(response.result).toBeDefined();
    expect(response.result.protocolVersion).toBeTruthy();
    expect(response.result.serverInfo?.name).toBeTruthy();
  }, 30_000);
});

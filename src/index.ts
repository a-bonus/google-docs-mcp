#!/usr/bin/env node

// src/index.ts
//
// Single entry point for the Google Docs MCP Server.
//
// Usage:
//   @a-bonus/google-docs-mcp          Start the MCP server (default)
//   @a-bonus/google-docs-mcp auth     Run the interactive OAuth flow
//
// Remote mode (env vars):
//   MCP_TRANSPORT=httpStream           Use Streamable HTTP instead of stdio
//   BASE_URL=https://...               Public URL for OAuth redirects
//   ALLOWED_DOMAINS=scio.cz,...        Restrict to specific Google Workspace domains

import { FastMCP } from 'fastmcp';
import { OAuthProxy } from 'fastmcp/auth';
import {
  buildCachedToolsListPayload,
  collectToolsWhileRegistering,
  installCachedToolsListHandler,
} from './cachedToolsList.js';
import { initializeGoogleClient } from './clients.js';
import { parseEnabledToolGroups, registerAllTools } from './tools/index.js';
import { wrapServerForRemote } from './remoteWrapper.js';
import { registerLandingPage } from './landingPage.js';
import { registerDownloadRoute } from './downloadProxy.js';
import { FirestoreTokenStorage } from './firestoreTokenStorage.js';
import { parseStatelessFlag } from './config.js';
import { enableUpstreamOfflineAccess } from './upstreamAuth.js';
import { logger } from './logger.js';

// --- Auth subcommand ---
if (process.argv[2] === 'auth') {
  const { runAuthFlow } = await import('./auth.js');
  try {
    await runAuthFlow();
    logger.info('Authorization complete. You can now start the MCP server.');
    process.exit(0);
  } catch (error: any) {
    logger.error('Authorization failed:', error.message || error);
    process.exit(1);
  }
}

// --- Server startup ---

process.on('uncaughtException', (error: NodeJS.ErrnoException) => {
  logger.error('Uncaught Exception:', error);
  if (error.code === 'EPIPE' || error.code === 'ERR_STREAM_DESTROYED') {
    process.exit(1);
  }
});

process.on('unhandledRejection', (reason, _promise) => {
  logger.error('Unhandled Promise Rejection:', reason);
});

process.stdin.on('end', () => {
  logger.info('stdin closed — MCP host disconnected. Shutting down.');
  process.exit(0);
});

process.stdin.on('error', () => {
  process.exit(0);
});

// Graceful shutdown on termination signals.
// Without these handlers, a host that sends SIGTERM (rather than closing
// stdin) leaves the server running and accumulating in the background.
const cleanShutdown = (signal: string) => {
  logger.info(`Received ${signal} — shutting down.`);
  process.exit(0);
};
process.on('SIGTERM', () => cleanShutdown('SIGTERM'));
process.on('SIGINT', () => cleanShutdown('SIGINT'));
process.on('SIGHUP', () => cleanShutdown('SIGHUP'));

// Orphan-process watchdog (stdio mode only).
// In practice, some MCP clients exit without sending SIGTERM, and the
// stdin 'end' event can be swallowed by the transport's internal read
// loop — leaving the server running as a zombie that consumes CPU and
// memory indefinitely. As a backstop, detect reparenting to init
// (PID 1) and exit. The check runs every 10 s and is unref()'d so it
// does not keep the event loop alive on its own.
if (process.env.MCP_TRANSPORT !== 'httpStream') {
  const initialPpid = process.ppid;
  const watchdog = setInterval(() => {
    if (process.ppid !== initialPpid && process.ppid === 1) {
      logger.info(
        `Parent process (was PID ${initialPpid}) exited; reparented to init. Shutting down.`
      );
      process.exit(0);
    }
  }, 10_000);
  watchdog.unref();
}

const isRemote = process.env.MCP_TRANSPORT === 'httpStream';

if (isRemote) {
  const missing = ['BASE_URL', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'].filter(
    (k) => !process.env[k]
  );
  if (missing.length > 0) {
    logger.error(`FATAL: Missing required env vars for httpStream mode: ${missing.join(', ')}`);
    process.exit(1);
  }
}

const GOOGLE_API_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/script.external_request',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/calendar.events',
];

const oauthProxy = isRemote
  ? new OAuthProxy({
      upstreamAuthorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
      upstreamTokenEndpoint: 'https://oauth2.googleapis.com/token',
      upstreamClientId: process.env.GOOGLE_CLIENT_ID!,
      upstreamClientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      baseUrl: process.env.BASE_URL!,
      scopes: GOOGLE_API_SCOPES,
      allowedRedirectUriPatterns: [
        'http://localhost:*',
        `${process.env.BASE_URL}/*`,
        'cursor://*',
        'https://claude.ai/*',
        'https://claude.com/*',
        'claude://*',
      ],
      jwtSigningKey: process.env.JWT_SIGNING_KEY,
      encryptionKey: process.env.TOKEN_ENCRYPTION_KEY,
      consentRequired: false,
      accessTokenTtl: 2592000,
      refreshTokenTtl: 2592000,
      ...(process.env.TOKEN_STORE === 'firestore' && {
        tokenStorage: new FirestoreTokenStorage(process.env.GCLOUD_PROJECT),
      }),
    })
  : undefined;

if (oauthProxy) {
  // issueSwappedTokens() inlines the TTL logic: it checks
  // upstreamTokens.expiresIn > 0 BEFORE config.accessTokenTtl.
  // Google always returns expiresIn=3600, so our 30-day config is
  // never reached. Zero it out so the config fallback is used.
  const origIssue = (oauthProxy as any).issueSwappedTokens.bind(oauthProxy);
  (oauthProxy as any).issueSwappedTokens = async function (clientId: string, upstreamTokens: any) {
    if (this.config.accessTokenTtl) {
      return origIssue(clientId, { ...upstreamTokens, expiresIn: 0 });
    }
    return origIssue(clientId, upstreamTokens);
  };

  enableUpstreamOfflineAccess(oauthProxy);
}

const server = new FastMCP({
  name: 'Ultimate Google Docs & Sheets MCP Server',
  version: '1.0.0',
  ...(isRemote &&
    oauthProxy && {
      authenticate: async (request: any) => {
        if (!request) return undefined;
        const authHeader = request.headers?.authorization;
        if (!authHeader?.startsWith('Bearer ')) return undefined;
        const token = authHeader.slice(7);
        const upstreamTokens = await oauthProxy.loadUpstreamTokens(token);
        if (!upstreamTokens) return undefined;
        return {
          accessToken: upstreamTokens.accessToken,
          refreshToken: upstreamTokens.refreshToken,
          expiresAt: upstreamTokens.expiresIn
            ? Math.floor(Date.now() / 1000) + upstreamTokens.expiresIn
            : undefined,
          idToken: upstreamTokens.idToken,
          scopes: upstreamTokens.scope,
        };
      },
      oauth: {
        enabled: true,
        authorizationServer: oauthProxy.getAuthorizationServerMetadata(),
        protectedResource: {
          authorizationServers: [process.env.BASE_URL!],
          resource: process.env.BASE_URL!,
          scopesSupported: GOOGLE_API_SCOPES,
        },
        proxy: oauthProxy,
      },
    }),
});

const registeredTools: Parameters<FastMCP['addTool']>[0][] = [];
collectToolsWhileRegistering(server, registeredTools);
if (isRemote) wrapServerForRemote(server);
let enabledToolGroups: ReturnType<typeof parseEnabledToolGroups>;
try {
  enabledToolGroups = parseEnabledToolGroups();
  registerAllTools(server, enabledToolGroups);
  logger.info(`Registered tool groups: ${enabledToolGroups.join(', ')}.`);
} catch (error: any) {
  logger.error(`FATAL: Invalid MCP_TOOL_GROUPS: ${error.message || error}`);
  process.exit(1);
}

try {
  if (isRemote) {
    logger.info('Starting in remote mode (httpStream + MCP OAuth 2.1)...');
    registerLandingPage(server, registeredTools.length);
    registerDownloadRoute(server);

    const port = parseInt(process.env.PORT || '8080');
    await server.start({
      transportType: 'httpStream',
      httpStream: {
        port,
        host: '0.0.0.0',
        stateless: parseStatelessFlag(),
      },
    });

    logger.info(`MCP Server running at ${process.env.BASE_URL || `http://0.0.0.0:${port}`}/mcp`);
  } else {
    logger.info('Starting Ultimate Google Docs & Sheets MCP server...');

    const cachedToolsList = await buildCachedToolsListPayload(registeredTools);
    await server.start({ transportType: 'stdio' as const });
    installCachedToolsListHandler(server, cachedToolsList);
    logger.info('MCP Server running using stdio. Awaiting client connection...');

    // Warm up the Google client *after* the transport is live, and never let it
    // stop the server from running.
    //
    // Authorizing before server.start() meant a host could never complete the
    // MCP `initialize` handshake when credentials were unavailable: missing
    // credentials threw and the catch below called process.exit(1), while a
    // missing saved token sent authorize() into the interactive browser flow,
    // which blocks on a local callback server and hangs startup indefinitely.
    // Either way the client saw "server exited" instead of a handshake.
    //
    // Tools already resolve the client lazily (getDocsClient() and friends call
    // initializeGoogleClient() per request and raise a UserError when it fails),
    // so deferring this costs nothing and keeps auth problems scoped to the
    // calls that actually need Google.
    void initializeGoogleClient().catch((authError: any) => {
      logger.error(
        `Google authorization is not available yet: ${authError?.message || authError} ` +
          'The server is running and will answer initialize and tools/list; individual tool ' +
          'calls will fail until authorization succeeds. Run `npx @a-bonus/google-docs-mcp auth` ' +
          'to complete the OAuth flow.'
      );
    });
  }
  logger.info('Process-level error handling configured to prevent crashes from timeout errors.');
} catch (startError: any) {
  logger.error('FATAL: Server failed to start:', startError.message || startError);
  process.exit(1);
}

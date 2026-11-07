import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexSurface, CodexAppServerStdioTransport } from '../packages/backend/dist/index.js';
import { CodexAppServerClient } from '../packages/backend/dist/protocol.js';

// Run against the selected real CLI with no user credentials, project config or turns.
const command = process.argv[2] ?? 'codex';
const env = Object.fromEntries(['PATH', 'HOME', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'PATHEXT']
  .filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
const version = execFileSync(command, ['--version'], { env, encoding: 'utf8' }).trim();
for (const requiredHumanApproval of [false, true]) {
  const home = await mkdtemp(join(tmpdir(), 'sdk-cli-'));
  const client = new CodexAppServerClient(new CodexAppServerStdioTransport({
    command, env, cwd: home, codexHome: home,
    configOverrides: ['cli_auth_credentials_store="file"', 'analytics.enabled=false', 'feedback.enabled=false'],
  }));
  const surface = new CodexSurface({ client, codexHome: home, requiredHumanApproval, autoSelectFirstConversation: false });
  try {
    const snapshot = await surface.connect();
    assert.equal(snapshot.status, 'ready');
    assert.equal(snapshot.authentication.status, 'loaded');
    assert.equal(snapshot.authentication.account, null);
    assert.equal(snapshot.authentication.requiresOpenaiAuth, true);
    assert.deepEqual(snapshot.conversations, []);
    assert.deepEqual(snapshot.messages, []);
    // Read through the initialized native client, not just the surface projection.
    const identity = await client.initialize({
      clientInfo: { name: 'sdk_compatibility', title: null, version: '1' },
      capabilities: { experimentalApi: true, requestAttestation: false },
    });
    assert.equal(await realpath(identity.codexHome), await realpath(home));
    const account = await client.request('account/read', { refreshToken: false });
    assert.equal(account.account, null);
    assert.equal(account.requiresOpenaiAuth, true);
    console.log(`${version}: isolated SDK connection passed (requiredHumanApproval=${requiredHumanApproval})`);
  } finally {
    try { await surface.close(); }
    finally { await rm(home, { recursive: true, force: true }); }
  }
}

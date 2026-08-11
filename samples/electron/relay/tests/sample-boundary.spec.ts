// @vitest-environment node

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { sdkSourceAliases } from '../../../vite.sdk-aliases';

const sampleRoot = path.resolve(import.meta.dirname, '..');

describe('Relay sample product boundary', () => {
  it('uses the official TypeScript MCP SDK as a direct sample dependency', () => {
    const packageJson = JSON.parse(readFileSync(path.join(sampleRoot, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };

    expect(packageJson.dependencies['@modelcontextprotocol/sdk']).toMatch(/^\^1\./);
    expect(packageJson.dependencies.zod).toBeDefined();
  });

  it('maps every imported Core subpath directly during source-mode development', () => {
    expect(sdkSourceAliases).toMatchObject({
      '@codex-app-sdk/core/events': expect.stringMatching(/packages\/core\/src\/typed-event-bus\.ts$/),
      '@codex-app-sdk/core/native': expect.stringMatching(/packages\/core\/src\/native\.ts$/),
      '@codex-app-sdk/core/surface': expect.stringMatching(/packages\/core\/src\/surface\.ts$/),
      '@codex-app-sdk/core/surface-bridge': expect.stringMatching(/packages\/core\/src\/surface-bridge\.ts$/),
    });
  });

  it('keeps MCP registration trusted and the conversation pane SDK-owned', () => {
    const main = readFileSync(path.join(sampleRoot, 'src/main/index.ts'), 'utf8');
    const app = readFileSync(path.join(sampleRoot, 'src/renderer/App.vue'), 'utf8');

    expect(main).toContain('mcpServers: [{');
    expect(main).toContain("toolApprovalMode: 'writes'");
    expect(app).toContain('<CodexConversationPane');
    expect(app).not.toContain(':presentation=');
    expect(app).not.toContain(':capabilities=');
    expect(app).not.toMatch(/thread\/(start|resume)|turn\/start|JSON-RPC/);
  });

  it('keeps the business workspace vertical beside the conversation', () => {
    const styles = readFileSync(path.join(sampleRoot, 'src/renderer/styles.css'), 'utf8');

    expect(styles).toContain('"header header"');
    expect(styles).toContain('"operations conversation"');
    expect(styles).toMatch(/\.operations-board__workspace\s*{[^}]*grid-area: operations;/s);
    expect(styles).toMatch(/\.relay-conversation\s*{[^}]*grid-area: conversation;/s);
  });
});

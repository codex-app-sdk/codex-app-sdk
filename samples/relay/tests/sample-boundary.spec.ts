// @vitest-environment node

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const sampleRoot = path.resolve(import.meta.dirname, '..');

describe('Relay sample product boundary', () => {
  it('uses the official TypeScript MCP SDK as a direct sample dependency', () => {
    const packageJson = JSON.parse(readFileSync(path.join(sampleRoot, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };

    expect(packageJson.dependencies['@modelcontextprotocol/sdk']).toMatch(/^\^1\./);
    expect(packageJson.dependencies.zod).toBeDefined();
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
});

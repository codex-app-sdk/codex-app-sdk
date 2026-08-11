// @vitest-environment node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Spark sample SDK customization boundary', () => {
  it('uses a dev-server port that does not collide with Codex Claw', () => {
    const viteConfig = readFileSync(resolve(import.meta.dirname, '../vite.config.ts'), 'utf8');

    expect(viteConfig).toContain("server: { host: '127.0.0.1', port: 5177, strictPort: true }");
    expect(viteConfig).not.toContain('port: 5174');
  });

  it('reuses the default pane and styles it only through host classes and public tokens', () => {
    const app = readFileSync(resolve(import.meta.dirname, '../src/renderer/App.vue'), 'utf8');
    const styles = readFileSync(resolve(import.meta.dirname, '../src/renderer/styles.css'), 'utf8');

    expect(app).toContain('<CodexConversationPane');
    expect(app).toContain('class="spark-chat"');
    expect(app).toContain(':capabilities="sparkCapabilities"');
    expect(app).toContain(':presentation="sparkPresentation"');
    expect(styles).toContain('--codex-font-family:');
    expect(styles).toContain('--codex-message-font-size:');
    expect(styles).toContain('--codex-composer-control-size:');
    expect(styles).toContain('--codex-primary-color:');
    expect(styles).toMatch(/\.spark-sidebar__list\s*\{[^}]*grid-auto-rows:\s*72px;/s);
    expect(styles).toMatch(/\.spark-sidebar__list\s*\{[^}]*overflow-y:\s*auto;/s);
    expect(styles).toMatch(/\.spark-chat-card\s*\{[^}]*height:\s*72px;/s);
    expect(styles).not.toMatch(/\.(?:codex|chat)-/);
    expect(styles).not.toMatch(/--(?:color|font-size|space)-/);
  });
});

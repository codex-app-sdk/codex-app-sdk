// @vitest-environment node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('basic sample renderer security policy', () => {
  it('ships a restrictive CSP without remote scripts or executable inline script', () => {
    const html = readFileSync(resolve(import.meta.dirname, '../src/renderer/index.html'), 'utf8');

    expect(html).toContain('http-equiv="Content-Security-Policy"');
    expect(html).toContain("default-src 'self'");
    expect(html).toContain("script-src 'self'");
    expect(html).toContain("object-src 'none'");
    expect(html).toContain("base-uri 'none'");
    expect(html).toContain("form-action 'none'");
    expect(html).not.toContain("script-src 'unsafe-inline'");
    expect(html).not.toContain("'unsafe-eval'");
    expect(html).not.toContain('googleusercontent.com');
  });
});

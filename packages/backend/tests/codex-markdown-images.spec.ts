import { afterEach, describe, expect, it } from 'vitest';
import { CodexAppServerClient } from '../src/codex';
import { CodexMarkdownImageHydrator, localImagePath } from '../src/node/codex-markdown-images';
import { FakeTransport, generatedPngBase64 } from './helpers/codex-surface-fixture';

describe('CodexMarkdownImageHydrator', () => {
  const clients: CodexAppServerClient[] = [];

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close()));
  });

  it('materializes absolute and workspace-relative Markdown images through app-server', async () => {
    const paths: string[] = [];
    const transport = new FakeTransport({
      'fs/readFile': (params) => {
        paths.push((params as { path: string }).path);
        return { dataBase64: generatedPngBase64 };
      },
    });
    const client = new CodexAppServerClient(transport);
    clients.push(client);
    await client.start();

    const result = await new CodexMarkdownImageHydrator(client).hydrate([
      '![absolute](/tmp/generated.png)',
      '![relative](images/chart.png "Chart")',
    ].join('\n'), '/tmp/project');

    const dataUrl = `data:image/png;base64,${generatedPngBase64}`;
    expect(result).toBe([
      `![absolute](${dataUrl})`,
      `![relative](${dataUrl} "Chart")`,
    ].join('\n'));
    expect(paths).toStrictEqual(['/tmp/generated.png', '/tmp/project/images/chart.png']);
  });

  it('leaves remote, unsafe, unsupported, invalid, and fenced image references unchanged', async () => {
    const transport = new FakeTransport({
      'fs/readFile': () => ({ dataBase64: 'not-an-image' }),
    });
    const client = new CodexAppServerClient(transport);
    clients.push(client);
    await client.start();
    const source = [
      '![remote](https://example.com/image.png)',
      '![traversal](../private.png)',
      '![svg](/tmp/vector.svg)',
      '![invalid](/tmp/invalid.png)',
      '```md',
      '![example](/tmp/example.png)',
      '```',
    ].join('\n');

    await expect(new CodexMarkdownImageHydrator(client).hydrate(source, '/tmp/project')).resolves.toBe(source);
    expect(transport.sent.filter((message) => 'method' in message && message.method === 'fs/readFile')).toHaveLength(1);
  });
});

describe('localImagePath', () => {
  it('normalizes supported file URLs and rejects relative paths without an absolute cwd', () => {
    expect(localImagePath('file:///tmp/preview%20one.png')).toBe('/tmp/preview one.png');
    expect(localImagePath('preview.png')).toBeNull();
  });
});

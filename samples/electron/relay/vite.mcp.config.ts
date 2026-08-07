import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

const sampleRoot = fileURLToPath(new URL('.', import.meta.url));
const mcpEntry = fileURLToPath(new URL('./src/mcp/server.ts', import.meta.url));
const mcpOutDir = fileURLToPath(new URL('./dist-mcp', import.meta.url));

export default defineConfig({
  root: sampleRoot,
  build: {
    outDir: mcpOutDir,
    emptyOutDir: true,
    minify: false,
    lib: {
      entry: mcpEntry,
      formats: ['es'],
      fileName: () => 'server.js',
    },
    rolldownOptions: {
      external: [/^node:/, /^@modelcontextprotocol\/sdk\//, /^zod$/],
    },
  },
});

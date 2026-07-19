import { access, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const cssPath = fileURLToPath(new URL('../dist/codex-app-sdk.css', import.meta.url));
const vueDeclarationPath = fileURLToPath(new URL('../dist/vue/index.d.ts', import.meta.url));
const css = await readFile(cssPath, 'utf8');
const requiredMarkers = [
  '.codex-text-shimmer',
  '.codex-markdown',
  '.codex-markdown .katex-display',
  '.codex-chat-theme{font-family:var(--font-family-base)}',
  ':where(.codex-chat-theme)',
  '.codex-chat-theme--dark',
  '.codex-chat-theme--system',
  '@media (prefers-color-scheme:dark)',
  '--font-size-15:15px',
  '--codex-message-font-size',
  '--codex-composer-font-size',
  '--codex-menu-font-size',
  '--codex-composer-control-size',
  '--codex-message-action-control-size',
  '.codex-composer-menu-list__switch',
  '.codex-conversation-pane',
];
const missingMarkers = requiredMarkers.filter((marker) => !css.includes(marker));

if (missingMarkers.length > 0) {
  throw new Error(`The published CSS bundle is missing: ${missingMarkers.join(', ')}`);
}

if (/\.codex-chat-theme \*\{[^}]*font-family/.test(css)) {
  throw new Error('The published CSS must let themed descendants inherit specialized fonts.');
}

if (css.includes('data:font/')) {
  throw new Error('The published CSS must reference KaTeX fonts as files, not inline them.');
}

await access(fileURLToPath(new URL('../dist/fonts/KaTeX_Main-Regular.woff2', import.meta.url)));

const vueDeclaration = await readFile(vueDeclarationPath, 'utf8');
if (vueDeclaration.includes('styles.css')) {
  throw new Error('The Vue declaration entry must not contain a dangling styles.css import.');
}

console.log(`verified ${requiredMarkers.length} SDK CSS markers in dist/codex-app-sdk.css`);

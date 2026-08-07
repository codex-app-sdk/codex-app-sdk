import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const distCssPath = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : fileURLToPath(new URL('../dist/codex-app-sdk.css', import.meta.url));
const katexCssPath = fileURLToPath(new URL('../node_modules/katex/dist/katex.min.css', import.meta.url));
const katexFontsPath = fileURLToPath(new URL('../node_modules/katex/dist/fonts', import.meta.url));
const distFontsPath = process.argv[3]
  ? path.resolve(process.cwd(), process.argv[3])
  : fileURLToPath(new URL('../dist/fonts', import.meta.url));

const [builtCss, katexCss] = await Promise.all([
  readFile(distCssPath, 'utf8'),
  readFile(katexCssPath, 'utf8'),
]);

const fontFaces = [...katexCss.matchAll(/@font-face\{([^}]*)\}/g)].map(([, body]) => {
  const source = /src:url\(fonts\/([^)]*?\.woff2)\)/.exec(body)?.[1];
  if (!source) {
    throw new Error('Could not find the KaTeX WOFF2 source while packaging CSS.');
  }
  const beforeSource = body.slice(0, body.indexOf('src:'));
  return `@font-face{${beforeSource}src:url("./fonts/${source}") format("woff2")}`;
});

const cssWithoutInlinedKatexFonts = builtCss.replace(/@font-face\{[^}]*data:font\/woff2[^}]*\}/g, '');
await mkdir(distFontsPath, { recursive: true });
await Promise.all(fontFaces.map(async (fontFace) => {
  const source = /url\("\.\/fonts\/([^)]*?\.woff2)"\)/.exec(fontFace)?.[1];
  if (!source) throw new Error('Could not resolve a packaged KaTeX font.');
  await cp(fileURLToPath(new URL(`../node_modules/katex/dist/fonts/${source}`, import.meta.url)), `${distFontsPath}/${source}`);
}));

await writeFile(distCssPath, `${fontFaces.join('')}\n${cssWithoutInlinedKatexFonts}`);
console.log(`packaged ${fontFaces.length} KaTeX WOFF2 fonts as CSS assets`);

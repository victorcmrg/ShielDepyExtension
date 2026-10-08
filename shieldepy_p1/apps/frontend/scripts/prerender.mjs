// Último passo do `npm run build`: renderiza a landing (bundle SSR em dist-ssr/) e injeta o HTML no
// dist/index.html, no lugar do <!--landing-->. Depois apaga o dist-ssr (não vai pra produção).
import { readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url);
const ssrDir = fileURLToPath(new URL('dist-ssr/', root));
const indexPath = fileURLToPath(new URL('dist/index.html', root));

const { render } = await import(pathToFileURL(ssrDir + 'prerender.js').href);
const html = await readFile(indexPath, 'utf8');
if (!html.includes('<!--landing-->')) throw new Error('dist/index.html sem o marcador <!--landing-->');
await writeFile(indexPath, html.replace('<!--landing-->', () => render()));
await rm(ssrDir, { recursive: true, force: true });
console.log('✓ landing pré-renderizada em dist/index.html');

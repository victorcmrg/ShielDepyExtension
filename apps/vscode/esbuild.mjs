import { copyFileSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

// As gramáticas .wasm moram em @shieldepy/core; a extensão as lê de <extensionPath>/wasm.
function copyWasm() {
  const from = join(here, '..', '..', 'packages', 'core', 'wasm');
  const to = join(here, 'wasm');
  mkdirSync(to, { recursive: true });
  for (const file of readdirSync(from).filter((f) => f.endsWith('.wasm'))) copyFileSync(join(from, file), join(to, file));
}

// Bibliotecas do visualizador do mapa (Cytoscape + fcose): o webview as carrega de
// <extensionPath>/media/vendor, com nonce — a lista é a mesma que o @shieldepy/viewer usa.
function copyViewerLibraries() {
  const viewerDir = join(here, '..', '..', 'packages', 'viewer');
  const libraries = JSON.parse(readFileSync(join(viewerDir, 'libraries.json'), 'utf8'));
  const require = createRequire(join(viewerDir, 'package.json'));
  const to = join(here, 'media', 'vendor');
  mkdirSync(to, { recursive: true });
  for (const lib of libraries) copyFileSync(require.resolve(lib.specifier), join(to, lib.file));
}

// Emite os marcadores "[watch] build started/finished" que o problemMatcher do F5 espera.
const watchMarkersPlugin = {
  name: 'watch-markers',
  setup(build) {
    build.onStart(() => console.log('[watch] build started'));
    build.onEnd((result) => {
      for (const { text, location } of result.errors) {
        console.error(`✘ [ERROR] ${text}`);
        if (location) console.error(`    ${location.file}:${location.line}:${location.column}:`);
      }
      console.log('[watch] build finished');
    });
  },
};

copyWasm();
copyViewerLibraries();

// Dois arquivos: a extensão e o pipeline de caos (LangGraph, SDKs de IA), carregado só quando
// a pessoa roda "Testar Caos" — o bundle principal continua leve.
const ctx = await esbuild.context({
  entryPoints: { extension: join(here, 'src', 'extension.ts'), chaos: join(here, 'src', 'chaos', 'run-chaos.ts') },
  bundle: true,
  format: 'cjs',
  minify: production,
  sourcemap: !production,
  platform: 'node',
  target: 'node18',
  external: ['vscode'],
  outdir: join(here, 'dist'),
  logLevel: 'info',
  plugins: [watchMarkersPlugin],
});

if (watch) {
  await ctx.watch();
} else {
  await ctx.rebuild();
  await ctx.dispose();
}

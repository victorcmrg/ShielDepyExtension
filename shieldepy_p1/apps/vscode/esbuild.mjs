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

const ctx = await esbuild.context({
  entryPoints: [join(here, 'src', 'extension.ts')],
  bundle: true,
  format: 'cjs',
  minify: production,
  sourcemap: !production,
  platform: 'node',
  target: 'node18',
  external: ['vscode'],
  outfile: join(here, 'dist', 'extension.js'),
  logLevel: 'info',
  plugins: [watchMarkersPlugin],
});

// A CLI do ShielDepy, empacotada junto (dist/shieldepy-cli.mjs): o comando "Rodar testes de caos"
// a executa num processo à parte. Em ESM, para o defaultWasmDir (import.meta.url) achar <extensão>/wasm;
// o banner dá `require` aos pacotes CJS embutidos (LangGraph e companhia).
const cliCtx = await esbuild.context({
  entryPoints: [join(here, '..', 'cli', 'src', 'bundle-entry.ts')],
  bundle: true,
  format: 'esm',
  minify: production,
  sourcemap: false,
  platform: 'node',
  target: 'node20',
  outfile: join(here, 'dist', 'shieldepy-cli.mjs'),
  banner: {
    js: [
      "import { createRequire as __shieldepyRequire } from 'node:module';",
      "import { fileURLToPath as __shieldepyPath } from 'node:url';",
      "import { dirname as __shieldepyDir } from 'node:path';",
      'const require = __shieldepyRequire(import.meta.url);',
      'const __filename = __shieldepyPath(import.meta.url);',
      'const __dirname = __shieldepyDir(__filename);',
    ].join(' '),
  },
  logLevel: 'warning',
});

if (watch) {
  await ctx.watch();
  await cliCtx.watch();
} else {
  await ctx.rebuild();
  await cliCtx.rebuild();
  await ctx.dispose();
  await cliCtx.dispose();
}

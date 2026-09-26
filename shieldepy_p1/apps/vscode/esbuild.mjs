import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
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

if (watch) {
  await ctx.watch();
} else {
  await ctx.rebuild();
  await ctx.dispose();
}

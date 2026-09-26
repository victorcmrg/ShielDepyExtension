// Copia os .wasm que o GraphManager precisa pra dentro de wasm/ — roda sozinho no `npm install`
// (via "postinstall"), então ninguém precisa baixar essas gramáticas manualmente.
const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '..');
const wasmDir = path.join(projectRoot, 'wasm');

const files = [
  {
    from: path.join(projectRoot, 'node_modules', 'web-tree-sitter', 'tree-sitter.wasm'),
    to: path.join(wasmDir, 'tree-sitter.wasm'),
  },
  {
    from: path.join(projectRoot, 'node_modules', 'tree-sitter-wasms', 'out', 'tree-sitter-typescript.wasm'),
    to: path.join(wasmDir, 'tree-sitter-typescript.wasm'),
  },
  {
    from: path.join(projectRoot, 'node_modules', 'tree-sitter-wasms', 'out', 'tree-sitter-tsx.wasm'),
    to: path.join(wasmDir, 'tree-sitter-tsx.wasm'),
  },
];

fs.mkdirSync(wasmDir, { recursive: true });

let missing = 0;
for (const { from, to } of files) {
  if (!fs.existsSync(from)) {
    console.warn(`[copy-wasm] não encontrado: ${from} — rode "npm install" novamente.`);
    missing += 1;
    continue;
  }
  fs.copyFileSync(from, to);
  console.log(`[copy-wasm] ${path.basename(to)} copiado.`);
}

if (missing > 0) {
  process.exitCode = 1;
}

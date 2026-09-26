// Copia os .wasm que o TsParser precisa pra dentro de wasm/ — roda sozinho no `npm install`
// (via "postinstall"). Resolve pelos pacotes em vez de caminho fixo: com workspaces o
// node_modules fica içado na raiz do monorepo.
const fs = require('fs');
const path = require('path');

const wasmDir = path.join(__dirname, '..', 'wasm');

function fromPackage(pkg, rel) {
  try {
    return path.join(path.dirname(require.resolve(`${pkg}/package.json`)), rel);
  } catch {
    return undefined;
  }
}

const files = [
  { from: fromPackage('web-tree-sitter', 'tree-sitter.wasm'), name: 'tree-sitter.wasm' },
  { from: fromPackage('tree-sitter-wasms', 'out/tree-sitter-typescript.wasm'), name: 'tree-sitter-typescript.wasm' },
  { from: fromPackage('tree-sitter-wasms', 'out/tree-sitter-tsx.wasm'), name: 'tree-sitter-tsx.wasm' },
];

fs.mkdirSync(wasmDir, { recursive: true });

let missing = 0;
for (const { from, name } of files) {
  if (!from || !fs.existsSync(from)) {
    console.warn(`[copy-wasm] não encontrado: ${name} — rode "npm install" novamente.`);
    missing += 1;
    continue;
  }
  fs.copyFileSync(from, path.join(wasmDir, name));
  console.log(`[copy-wasm] ${name} copiado.`);
}

if (missing > 0) process.exitCode = 1;

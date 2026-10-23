// Copia os .wasm que o TsParser e os extratores de regras precisam pra dentro de wasm/ — roda sozinho no `npm install`
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

// C#: a gramática NÃO vem do tree-sitter-wasms (a 0.1.13 não lê lambda com tipo de retorno nem construtor
// primário). O `wasm/tree-sitter-c_sharp.wasm` versionado é o do pacote oficial `tree-sitter-c-sharp@0.23.1`
// (MIT; a última com o formato 14 que o web-tree-sitter 0.22 aceita), sha256
// d7fe0bf8e8b8d26b2b253f375e3c43386b332d23f7b7b3e15d49fff180fe46e3. Fica fora da cópia para não ser sobrescrito.
const files = [
  { from: fromPackage('web-tree-sitter', 'tree-sitter.wasm'), name: 'tree-sitter.wasm' },
  { from: fromPackage('tree-sitter-wasms', 'out/tree-sitter-typescript.wasm'), name: 'tree-sitter-typescript.wasm' },
  { from: fromPackage('tree-sitter-wasms', 'out/tree-sitter-tsx.wasm'), name: 'tree-sitter-tsx.wasm' },
  { from: fromPackage('tree-sitter-wasms', 'out/tree-sitter-java.wasm'), name: 'tree-sitter-java.wasm' },
  { from: fromPackage('tree-sitter-wasms', 'out/tree-sitter-python.wasm'), name: 'tree-sitter-python.wasm' },
  { from: fromPackage('tree-sitter-wasms', 'out/tree-sitter-html.wasm'), name: 'tree-sitter-html.wasm' },
  { from: fromPackage('tree-sitter-wasms', 'out/tree-sitter-css.wasm'), name: 'tree-sitter-css.wasm' },
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

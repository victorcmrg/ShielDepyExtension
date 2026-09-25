Coloque aqui os três arquivos `.wasm` exigidos pelo `GraphManager` (veja o README na raiz do projeto,
seção "Arquivos .wasm do Tree-sitter"):

- `tree-sitter.wasm`
- `tree-sitter-typescript.wasm`
- `tree-sitter-tsx.wasm`

Esta pasta é lida em runtime via `context.extensionPath`, então os arquivos precisam existir aqui antes
de rodar `F5` / empacotar a extensão.

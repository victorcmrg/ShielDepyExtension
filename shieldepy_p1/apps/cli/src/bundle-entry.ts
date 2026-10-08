// Ponto de entrada da CLI empacotada junto da extensão (apps/vscode/dist/shieldepy-cli.mjs): é por
// ela que o botão "Rodar testes de caos" roda o pipeline, num processo à parte. Assim o LangGraph e
// o resto do caos não entram no extension.js, que carrega a cada abertura do VS Code.
// Empacotada em ESM: o `import.meta.url` do defaultWasmDir aponta para <extensão>/wasm.
import { main } from './main';

process.exitCode = await main(process.argv.slice(2));

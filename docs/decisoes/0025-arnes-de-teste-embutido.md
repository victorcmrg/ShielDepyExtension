# 0025 — O arnês de teste do caos vem da CLI, emprestado por links, sem instalar nada no projeto

**Data:** 2026-10-31 (escolha técnica, na MVP2) · **Estado:** valendo

**Contexto.** Os testes de caos gerados importam o Vitest, o supertest e o MSW, e o banco gerado (C2d) importa o PGlite. Nenhum dos 3 projetos da C1 tinha isso (o realworld usa Jest, os outros não têm testes): o primeiro passo era sempre um `npm install -D` no projeto do usuário, o que quebra o roteiro "instalar a extensão e rodar". Foram consideradas:
- **instalar no projeto** (o que o `--init` pedia): muda o `package.json` e o lock do usuário;
- **um alias do Vite para cada pacote**: cobre o código que passa pelo Vite, mas não o `vitest.config.ts` gerado (que importa `vitest/config` e é carregado antes de haver alias) nem os subcaminhos (`msw/node`);
- **links na pasta dos testes gerados**: `.shieldepy/chaos-tests/node_modules/<pacote>` aponta para o pacote da CLI. Os testes e o config moram ali, então a resolução normal do Node os acha, com subcaminhos e `exports`. A pasta já é apagada e regerada a cada rodada.

**Decisão.**
- O que falta no `node_modules` da raiz do projeto (Vitest, supertest, MSW; e o PGlite e o `pglite-socket`, se a CLI os tiver) é emprestado da CLI por link (junction no Windows, que não pede permissão de administrador). Os pacotes viram dependências da `@shieldepy/cli`.
- Para os arquivos de fora da pasta dos testes (o `chaos/setup.ts` importa o `vi`; o `chaos/db.ts`, o PGlite), o `vitest.config.ts` gerado ganha um alias exato (`^vitest$`) de cada pacote emprestado, antes dos aliases do projeto. O Vitest que roda é o emprestado, então o `vi` do setup é a mesma instância do executor.
- Só conta o `node_modules` da raiz do projeto: num monorepo com os pacotes içados mais acima, o link vem antes e o caos usa os da CLI. Fica previsível, e nada no projeto muda.
- O `rm` recursivo que apaga a pasta dos testes remove o link, não o pacote (conferido num teste).

**Consequências.**
- O `--init` deixa de pedir para instalar o que vai ser emprestado e diz que o caos usa os do ShielDepy.
- A extensão ainda não tem arnês: o bundle (`dist/chaos.js`) não leva o Vitest, e levar exigiria decidir o tamanho do `.vsix` (ou baixar o arnês na primeira execução). Lá, sem `import.meta.url`, o arnês fica desligado e vale o Vitest do projeto, como antes.
- O projeto que já tem os pacotes continua usando os dele.

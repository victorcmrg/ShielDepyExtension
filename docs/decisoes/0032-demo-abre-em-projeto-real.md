# 0032 — A demo abre num projeto real, com a extensão instalada pelo `.vsix`

**Data:** 2026-11-04 (escolha do usuário) · **Estado:** valendo · **Ajusta:** a [0028](0028-demo-so-o-motor-e-nest-fora.md)

**Contexto.** O `npm run demo` não rodou no PowerShell do usuário, porque a política de execução bloqueia o `npm.ps1`. O usuário propôs uma demo mais próxima do uso real: abrir um CRUD real do GitHub, com a extensão já instalada, e rodar tudo ali.

**Decisão.**
- **A demo abre no pg-crud** (`manfraio/rest_api_with_nodejs_and_postgres`, commit `fdd9fc7`), numa cópia em `~/ShielDepy-real/pg-crud`, com a extensão instalada pelo `.vsix` no VS Code do usuário.
- **Depois vem o `checkout`,** que continua sendo a parte com os 6 achados, a branch de correção e o portal.
- **A abertura é por atalhos `.cmd` na Área de Trabalho,** sem digitar nada no terminal. Dentro de um `.cmd`, o `npm` é o `npm.cmd`, que a política do PowerShell não bloqueia.

**Consequências.**
- O contrato do pg-crud vem preparado: o esquema e a invariante `categoriaSemNomeRepetido` foram escritos à mão, e o Vitest, o supertest e o MSW estão no `node_modules` dele, sem entrar no `package.json`. Isso precisa ser dito na apresentação. A DP8 continua aberta.
- O projeto real dá 1 achado e 1 "aguentou", sem branch de correção.
- Disponibilizar o `.vsix` para download público (GitHub Releases ou Marketplace) depende do usuário (DP2) e não faz parte da demo.

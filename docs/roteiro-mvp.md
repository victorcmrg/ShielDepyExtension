# Roteiro do MVP do ShielDepy

O passo a passo para mostrar o MVP de ponta a ponta: o caos achando problemas reais em dois frameworks, sem IA paga e sem internet na hora. É o "pronto quando" da [0018](decisoes/0018-mvp-caos-e-frameworks.md): instalar a extensão, abrir um projeto, gerar o contrato, rodar o caos e ver o achado no código, no relatório e no portal local.

A contribuição a mostrar é o motor: **o motor prova, a IA propõe** ([0001](decisoes/0001-motor-prova-ia-propoe.md)). Tudo abaixo roda com `--offline` (o motor sozinho, custo zero).

> **O que ainda está aberto:** o fluxo da demo (DP7: só o motor, ou com a compra mockada, o download e o login) e o arnês de teste dentro da extensão (DP8). Enquanto a DP8 não sai, o caos na extensão usa o Vitest do projeto: no `checkout-express` ele existe; no `checkout-fastify`, o caos roda pela CLI (passo 2). A tela da empresa mockada (MVP7) espera a DP7.

---

## Antes do dia (uma vez)

Da raiz do repositório:

```bash
npm install
npm install --prefix examples/checkout-express
npm install --prefix examples/checkout-express-fixed
npm install --prefix examples/checkout-fastify --ignore-scripts
npm install --prefix examples/checkout-fastify-fixed --ignore-scripts
npm run build:vscode
npm run package:vscode        # gera o .vsix em apps/vscode/ (vsce package)
```

Para conferir sem abrir janela nenhuma: `npm run demo:verificar:cli` (o passo 2, pela CLI, ~30 s). O ensaio completo, que abre um VS Code de teste e o portal local, é o `npm run demo:verificar` (~3 min). Grave um vídeo da demo inteira como plano B.

## 1. Express, ao vivo, na extensão

1. **Instalar:** no VS Code, *Extensões → … → Instalar do VSIX* e escolha o `.vsix` gerado (ou `code --install-extension apps/vscode/shieldepy-<versão>.vsix`). Para a apresentação, o `npm run demo` faz tudo de uma vez: monta o sistema da loja fora do repositório (`~/ShielDepy-demo`), sobe o portal local já logado e abre o VS Code com o `ROTEIRO.md` da demo ao lado. A partir daqui, siga o `ROTEIRO.md` que abre; os pontos principais são:
2. **O mapa:** botão **◇ Ver grafo do sistema**. A rota `POST /checkout` aparece com as operações na ordem (lê o estoque → cobra no Stripe sem timeout → grava o estoque → grava o pedido) e as tags de risco. 100% das chamadas provadas, nenhuma por nome.
3. **O contrato:** o `checkout` já vem com o `shieldepy.chaos.config.ts`. Para mostrar de onde ele sai, da raiz do repositório: `npm run cli -- chaos <cópia do checkout sem o contrato> --init` gera o `createApp`, o banco de teste (PGlite no lugar do `pg`), o `reset` e os corpos; sobram 3 pendências óbvias (o esquema, a resposta do Stripe, o parâmetro do `GET`).
4. **O caos:** botão **⚡ Rodar testes de caos** (todas as rotas, motor). Saem **6 achados**, cada um com o controle (a mesma requisição, sem caos) passando: a corrida no estoque (vende o último item duas vezes), o Stripe sem timeout, o 5xx e a resposta inválida do Stripe virando 500, e o cliente cobrado sem pedido quando o banco cai depois da cobrança. Os erros aparecem na linha certa do código (Problems) e no grafo final.
5. **O corrigido:** `git switch correcao` e **⚡** de novo: o mesmo teste aguenta, e os erros de caos somem. **Comparar Mapa com uma Branch → main** mostra o que a correção mudou.
6. **O portal:** a execução aparece no histórico do caos do portal local.

## 2. Fastify: o mesmo, em outro framework

O `examples/checkout-fastify` é o mesmo checkout em Fastify: um plugin registrado com `prefix: '/api'`, a validação num `preHandler` e o projeto só com `fastify` e `pg` (sem Vitest, sem supertest: a CLI empresta os dela). No terminal integrado do VS Code, da raiz do repositório:

```bash
npm run cli -- topology examples/checkout-fastify            # POST /api/checkout: validateCheckout → checkoutController.create, as 4 operações
npm run cli -- chaos examples/checkout-fastify --offline      # os mesmos 6 achados; exit 1
npm run cli -- chaos examples/checkout-fastify-fixed --offline  # aguenta; exit 0
```

O ponto a falar: o motor não sabe de "checkout"; ele leu as rotas do Fastify (`register` com prefixo, `preHandler`), seguiu as chamadas até o banco e o Stripe e gerou os mesmos testes. O `createApp` do contrato foi o `--init` que escreveu (um handler que espera o `ready()` do Fastify, [0026](decisoes/0026-fastify-createapp-pelo-handler.md)). Se preferir, este passo vai em vídeo.

## 3. Em projeto real: a tabela, num slide

Rodar projeto real ao vivo é lento e frágil (instalação, `prisma generate`, proxy). A tabela está em [`docs/pesquisa/mvp-resultados.md`](pesquisa/mvp-resultados.md): 17 achados verdadeiros, 0 falsos, todos com o controle passando, nos exemplos e em 3 projetos Express reais do GitHub; e as pendências do `--init` caindo da C1 para agora (10 → 7, 17 → 11, 9 → 6). Vale mostrar também o que o motor **não** finge: no fastify-prisma (rotas registradas num laço), o mapa dá 0 rotas e o caos diz "nada foi provado" (exit 2), em vez de um verde falso.

## 4. A empresa

O portal local com o histórico do caos já existe (passo 1.6). A página de plano e faturas mockada (MVP7) e um eventual fluxo de compra → download → login esperam a DP7. A recomendação, se entrar: o login pelo device flow que já existe e a execução aparecendo no portal, sem travar o mapa nem o caos atrás do login (a demo não pode depender do servidor).

---

## Se algo der errado

| Sintoma | O que fazer |
|---|---|
| O caos sai 2, "erro de ambiente" | o controle não passou: o app não subiu ou a requisição do contrato não vale. O relatório diz qual teste e por quê |
| O caos sai 2, "o mapa dá 0 rotas" | o framework não é lido (Koa, Hono, Next) ou registra as rotas de um jeito que o mapa não segue; o aviso diz quantos registros ficaram de fora (`shieldepy topology`) |
| O `npm install` do Fastify falha atrás do proxy | `NODE_OPTIONS=--use-system-ca` |
| O VS Code de teste não abre no `demo:verificar` | use o `demo:verificar:cli` para o passo 2 e o vídeo para o resto |

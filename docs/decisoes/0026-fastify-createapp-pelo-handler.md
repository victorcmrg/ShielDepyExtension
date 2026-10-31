# 0026 — No Fastify, o `createApp` do contrato devolve um handler que espera o `ready()`

**Data:** 2026-10-31 (escolha técnica, na MVP4) · **Estado:** valendo

**Contexto.** Os testes de caos gerados chamam `project.createApp()` uma vez, de forma síncrona, e passam o resultado ao `request(app)` do supertest. No Express isso é o próprio app (uma função `(req, res)`). O Fastify só atende depois do `ready()` (que carrega os plugins, assíncrono), e a instância não é uma função. Foram consideradas:
- **mudar os templates** para `await app.ready()` e `request(app.server)`: os testes gerados passam a saber de framework, e cada framework novo (NestJS, Koa) mexe neles;
- **usar o `app.inject()`** do Fastify no lugar do supertest: outro caminho de requisição, com resultado e timeout diferentes dos do Express, e os templates de novo dependentes do framework;
- **um handler no contrato**: `createApp: () => fastifyHandler(app)`, onde `fastifyHandler` devolve `(req, res) => app.ready().then(() => app.routing(req, res))`. O `routing` é API pública do Fastify (feita para servir a requisição de outro servidor HTTP).

**Decisão.**
- O contrato gerado pelo `--init` define o `fastifyHandler` e embrulha nele o app (a fábrica chamada, ou o app guardado pelo `chaos/setup.ts`). O supertest recebe uma função, como no Express, e os templates não mudam.
- Se o `ready()` falhar (um plugin que não carrega), a resposta é 500 com o erro no corpo: o controle do teste falha e o teste sai inválido, não achado.
- No modo `capture`, o `chaos/setup.ts` troca o `fastify` (o `vi.mock` e o módulo no cache do `require`) por um que guarda a instância e cujo `listen()` devolve a promessa, ou chama o callback, com um endereço falso, sem abrir porta.

**Consequências.**
- O `fastifyHandler` fica no contrato, à vista do usuário, e pode ser editado.
- O próximo framework (NestJS, MVP5) segue o mesmo caminho: o contrato entrega ao supertest uma função `(req, res)` (no Nest, o `getHttpAdapter().getInstance()` depois do `init()`).
- Conferido nos exemplos `checkout-fastify` (os mesmos 6 achados do Express) e `-fixed` (o mesmo quadro do `checkout-express-fixed`), e no `chaos-app-fastify.test.ts` (modo `capture` em ESM e CommonJS).

# Caos no CI: o ShielDepy como portão de PR

O ShielDepy lê o código (Tree-sitter, sem executar nada), acha as rotas HTTP que fazem I/O arriscado e gera testes de caos **só para elas**. Depois roda esses testes com o Vitest do seu projeto e bloqueia o PR quando o código quebra sob uma falha física: corrida entre requisições, API externa lenta, fora do ar ou respondendo lixo.

Um achado só conta quando o **controle** (a mesma requisição, sem falha injetada) passou. Se o controle falha, o problema é do ambiente ou do teste: o resultado sai como inválido e não bloqueia.

## O que você precisa no repositório

**Alvo suportado hoje:** Express com `pg` ou Prisma, e `fetch` ou `axios` para APIs externas.

1. **`shieldepy.chaos.config.ts` na raiz do app.** É o contrato: só o projeto sabe subir o app sem abrir porta, zerar o estado, dizer o que nunca pode acontecer e montar uma requisição válida.

   ```ts
   import { minStock, resetDb } from './chaos/db';
   import { createApp } from './src/app';

   export default {
     createApp,                        // o app Express, sem listen()
     setupFiles: ['chaos/setup.ts'],   // ex.: vi.mock('pg') apontando para um banco em memória (PGlite)
     async reset() {                   // estado limpo antes de cada teste
       await resetDb({ 'p-1': 1 });
     },
     invariants: {                     // o que nunca pode acontecer (true = ok)
       async stockNeverNegative() {
         return (await minStock()) >= 0;
       },
     },
     apis: {                           // resposta SAUDÁVEL de cada API externa (o MSW responde isso)
       'api.stripe.com': () => ({ id: 'ch_test', status: 'succeeded' }),
     },
     requests: {                       // uma requisição válida por rota (id = "MÉTODO /caminho")
       'POST /checkout': { path: '/checkout', body: { productId: 'p-1', quantity: 1 } },
     },
   };
   ```

   O ShielDepy lê esse arquivo pela AST (só os nomes) e só o executa dentro dos testes gerados. Exemplo completo: [`examples/checkout-express`](../examples/checkout-express).

2. **Dependências de teste:** `vitest`, `supertest` e `msw` nas `devDependencies`.
3. **`.shieldepy/` no `.gitignore`.** Os testes de caos são regerados a cada execução.

Para conferir localmente antes de ligar o CI:

```bash
node <shieldepy>/shieldepy_p1/apps/cli/bin/shieldepy.js chaos . --offline --report chaos-report.md
```

## O workflow

Copie [`shieldepy-chaos.template.yml`](shieldepy-chaos.template.yml) para `.github/workflows/shieldepy-chaos.yml` e ajuste o `env` do topo:

| Variável | O que é | Padrão |
|---|---|---|
| `APP_DIR` | pasta do app (onde está o `shieldepy.chaos.config.ts`) | `.` |
| `FAIL_ON` | severidade mínima que bloqueia o PR | `Alto` |
| `SHIELDEPY_REF` | versão do ShielDepy (branch, tag ou commit) | `main` |

O job baixa o ShielDepy, instala o ShielDepy e o app (`npm ci`), roda `shieldepy chaos`, publica o relatório no resumo do job e comenta no PR. Nas execuções seguintes, ele edita o mesmo comentário. O mapa interativo, com o resultado do caos e o diff do PR por cima, fica nos artefatos do job (`shieldepy-mapa`): baixe e abra o `chaos-map.html` no navegador. Com `#mudancas` no fim do endereço, ele já abre filtrado no que o PR mudou.

## Só o que o PR tocou (`--base`)

Em PR, o template roda `shieldepy chaos --base origin/<branch de destino>`. O ShielDepy monta o mapa do código no merge-base e compara com o do PR. Só as rotas sensíveis que o PR tocou vão para a IA e para os testes. A maioria dos PRs não toca rota sensível nenhuma: o job fica verde em segundos e sem custo.

Uma rota entra quando:
- é nova;
- mudou a cadeia de handlers, as operações de I/O ou as tags;
- mudou o corpo de qualquer função no caminho dela (não só as que fazem I/O);
- mudou o código de topo de um arquivo do caminho (ex.: a montagem das dependências).

Comentário, espaço e linhas deslocadas não contam. Mudança em `shieldepy.chaos.config.ts`, nos `setupFiles`, em `package.json`, num lockfile, num `tsconfig` ou na config do Vite/Vitest faz **todas** as rotas entrarem. O relatório diz o escopo e o motivo de cada rota.

O checkout precisa do histórico (`fetch-depth: 0`, como no template). Para ver só o diff, sem rodar nada: `shieldepy diff . --base origin/main`.

## Portal: o histórico de cada repositório

Com o portal do ShielDepy, cada execução do CI fica guardada e aparece na página do projeto: o status de cada repositório, o histórico das últimas execuções e, para cada execução, cada rota como uma linha do tempo das operações, com o ponto onde a falha injetada quebrou o código.

1. No portal, abra o projeto e, em **Integração com o CI**, crie um token. Ele aparece uma vez só: copie.
2. No GitHub, guarde o token como o secret `SHIELDEPY_PORTAL_TOKEN` e o endereço do portal como a variável `SHIELDEPY_PORTAL_URL` (Settings → Secrets and variables → Actions).
3. Pronto: o passo "Publicar no portal" do template manda cada resultado e põe o link da execução no comentário do PR.

O que vai para o portal: o resultado do caos e a superfície de ataque (rotas, operações de I/O, tabelas, hosts e `arquivo:linha`), mais o commit, a branch, o PR e o link do job. **Nenhum código-fonte.** O token só publica nos repositórios do próprio projeto, e o portal guarda as últimas 100 execuções de cada repositório. Se o portal estiver fora do ar, o passo falha sozinho e não muda o portão.

## Códigos de saída

| Código | Significa | No PR |
|---|---|---|
| 0 | nada quebrou, ou só achados abaixo do `--fail-on` | ✅ |
| 1 | achado com severidade `--fail-on` ou pior | ❌ bloqueia |
| 2 | erro de ambiente: o Vitest não rodou, ou todos os testes saíram inválidos. Nada foi provado | ❌ (ver o log) |

## Severidade

A severidade sai do motor, nunca da IA:

- **Crítico:** corrida (`race_condition`) ou falha parcial, e qualquer invariante de estado violada (`stateCheck`, `maxSuccesses`), mesmo sob falha de rede;
- **Alto:** a rota fica pendurada ou a falha vira 500 (`respondsWithin`, "não respondeu", `noUnhandledError`);
- **Médio:** a rota responde, mas com um status fora do esperado.

## IA e custo

Com o secret `ANTHROPIC_API_KEY`, a IA prioriza e explica as hipóteses, ajusta os parâmetros dos testes e escreve um parágrafo no relatório. Ela nunca escreve código, e a lista de hipóteses do motor nunca encolhe por causa dela. O custo de cada execução sai no rodapé do relatório.

Sem o secret, o workflow roda `--offline`: só o motor, custo zero, com os mesmos testes-base.

## Limites conhecidos

- Só Express. NestJS, Fastify e Next.js ainda não.
- `partial_failure_after_external_call` (falhar o banco depois da cobrança) e `retry_storm` aparecem no relatório como "sem teste no MVP" e não bloqueiam.
- O teste de timeout espera a paciência inteira (6 s), e uma rota que fica pendurada custa 10 s por teste. Os arquivos rodam em paralelo.

# Dataset de erros de produção (JSONL v1)

Para a equipe que treina o modelo de erros de produção (Llama-3.2-1B-Instruct com DPO). O ShielDepy gera os dados pelo próprio motor, e quem rotula é a execução dos testes, não um LLM juiz. A decisão está na [0016](decisoes/0016-dados-para-treino.md).

## Como gerar

```sh
# um projeto: acrescenta ao arquivo um registro por teste que rodou
npm run cli -- chaos <pasta> --offline --dataset dados.jsonl

# o corpus inteiro (exemplos + projetos reais fixados por commit), só offline
npm run dataset:gerar -- --dir <pasta-de-trabalho>

# os mutantes do código que aguenta (na mesma pasta; refaz o corpus)
npm run dataset:mutantes -- --dir <pasta-de-trabalho>

# os pares para o DPO, a partir do corpus
npm run dataset:pares -- --in <pasta-de-trabalho>/dataset.jsonl [--sem-fracos]
```

A pasta de trabalho fica fora do repositório. Lá ficam os clones, os mutantes, uma parte por projeto em `partes/`, o `dataset.jsonl` e o `pares.jsonl`.

- O projeto precisa do `shieldepy.chaos.config.ts` e das dependências instaladas (`npm install`), porque o caos roda o Vitest do próprio projeto.
- No modo `--offline`, as hipóteses e as specs são do motor e o custo é zero. Nada vai para a rede, a não ser o envio ao banco de vocês, quando a variável dele existe (abaixo).
- Sem `--offline`, a IA (Anthropic ou Gemini, com a chave do usuário) escreve as hipóteses e as specs. É chamada paga: estime antes com `npm run estimate:chaos`.
- O `--dataset` **acrescenta** ao arquivo. Rodar duas vezes o mesmo projeto no mesmo commit dá registros com o mesmo `id`, que você pode deduplicar por ele (o `dataset:gerar` já faz isso).
## Direto no banco de vocês (automático)

Com a variável `SHIELDEPY_DATASET_DATABASE_URL` apontando para o Postgres de vocês (o Neon), **cada execução do caos** grava os registros sozinha. Vale para o `shieldepy chaos` na CLI, para o plugin do VS Code (que lê o mesmo ambiente) e para os scripts acima. A decisão é a [0020](decisoes/0020-dataset-direto-no-neon.md).

```sh
# PowerShell (Windows), na máquina que gera; feche e reabra o VS Code para o plugin ler
setx SHIELDEPY_DATASET_DATABASE_URL "postgres://usuario:senha@ep-xxx.neon.tech/treino?sslmode=require"

# bash
export SHIELDEPY_DATASET_DATABASE_URL="postgres://usuario:senha@ep-xxx.neon.tech/treino?sslmode=require"
```

- A tabela `shieldepy_dataset` é criada na primeira vez: `id` (chave), `schema_version`, `project`, `variant`, `hypothesis_id`, `outcome`, `control`, `record` (o registro inteiro, em `jsonb`), `created_at` e `updated_at`.
- A gravação é por **upsert no `id`**: rodar de novo o mesmo projeto no mesmo commit atualiza a linha, não duplica.
- Se o banco estiver fora do ar, o caos só avisa e segue: o resultado dele não muda. O log mostra o host, nunca a URL (ela tem a senha).
- **Só nas nossas máquinas.** O registro leva o código das rotas. Com a variável definida, tudo em que o caos rodar vai para o banco: não use num projeto que não seja público ou nosso. Sem a variável, nada sai da máquina.
- Para ler: `SELECT record FROM shieldepy_dataset WHERE control = 'passed' AND outcome IN ('achado', 'aguentou')`. Os pares do DPO não vão para o banco; eles saem do `npm run dataset:pares` sobre o corpus.

## Um registro

Uma linha por hipótese testada, com as chaves em ordem alfabética: a mesma entrada gera o mesmo texto.

| Campo | O que é |
|---|---|
| `id` | Hash (32 hex) do projeto, repositório, pasta, commit, variante, motor e hipótese. |
| `schemaVersion` | `1`. Campo novo não muda a versão; campo que muda de sentido ou some muda. |
| `source.project` | O nome da pasta analisada (`checkout-express`). |
| `source.repo`, `source.commit`, `source.path` | O remote `origin` (sem usuário e senha), o commit e a pasta dentro do repositório. |
| `source.license` | `{ value, from }`: o `license` do `package.json`, ou a primeira linha do `LICENSE`, da pasta ou da raiz do repositório. Pode faltar; aí a licença é desconhecida. |
| `source.variant` | `original`, `fixed` (a pasta termina em `-fixed`) ou `mutante:<operador>@<arquivo>:<linha>`. |
| `source.mutation` | Só nos mutantes: `{ operator, file, line, description }`, o que foi tirado do código que aguentou. O resto da `source` é a do original. |
| `topologyHash` | O hash do mapa de onde as hipóteses saíram. |
| `route` | Método, path, `at` (`arquivo:linha`), `handlers` (a cadeia como está no registro da rota), `operations` em ordem (`kind`, `target`, `via`, `operation`, `lock`, `timeout`, `at`, `in`, `confidence`), `tags` e `confidence`. |
| `code[]` | O corpo de cada função da cadeia: os handlers e cada função no caminho até um I/O, na ordem. `symbol`, `at` (primeira linha), `endLine` e `text` (com `\n`). O recorte usa a faixa do símbolo no grafo (o nó do Tree-sitter). |
| `hypothesis` | `id` (`<rota>__<falha>__<alvo>`), `failure` (do catálogo), `agent`, `target`, `priority`, `rationale`, `author` (`{ engine: 'offline' }` ou `{ engine, model }`), `spec` (a spec validada), `specAuthor` e `discarded` (o que a validação jogou fora: proposta da IA com rota, falha ou alvo inventados, spec refeita pelo motor). |
| `result.control` | O teste sem caos: `passed`, `failed` ou `not-run`. |
| `result.chaos` | O teste com a falha injetada: `passed`, `failed` ou `not-run`. |
| `result.outcome` | `achado` (o controle passou e o caos falhou), `aguentou` (os dois passaram) ou `inválido` (o resultado não vale, e `message` diz por quê). |
| `result.message`, `result.violated`, `result.severity`, `result.durationMs` | A invariante que quebrou, como texto e como objeto da spec, a severidade (`Crítico`, `Alto`, `Médio`) e a duração. |
| `test.file`, `test.text` | O `.spec.ts` gerado (Vitest + supertest + MSW). |

## Como usar os rótulos

- **Exemplo positivo** (o código falha sob a falha): `outcome = achado`. O controle passou, por construção.
- **Exemplo negativo** (o código aguentou a falha): `outcome = aguentou`. Isso não quer dizer que a rota é segura: só que ela aguentou **esta** falha, com **este** teste.
- **Inválido**: fica no arquivo para você filtrar. Não use como exemplo; o motivo está em `message`.
- **Par para o DPO**: o mesmo `hypothesis.id` com `achado` numa variante e `aguentou` em outra da mesma família (o repositório e o projeto sem o sufixo `-fixed`). O `npm run dataset:pares` já monta os pares (abaixo).
- `route.operations[].confidence` e `route.confidence` com `heuristic` querem dizer que alguma ligação foi só por nome: pode faltar ou sobrar operação.

## Os mutantes

A partir do código que aguenta (o `checkout-express-fixed` e os reais preparados), uma mutação pela AST por mutante, numa cópia:

| Operador | O que tira |
|---|---|
| `sem-timeout` | o `signal`/`timeout` das opções de um `fetch` ou do `axios` |
| `sem-transacao` | as chamadas `query('BEGIN' / 'COMMIT' / 'ROLLBACK')` de uma função |
| `cobra-antes-de-reservar` | a ordem "reserva → cobrança": a reserva vai para depois da cobrança |
| `sem-estorno` | o estorno (`refund`) do `catch` depois da API |

Os passos (reserva, cobrança, estorno) são reconhecidos pelo nome do método chamado. Um mutante que "aguentou" continua no corpus com esse rótulo, porque nem toda mutação quebra um teste: tirar o timeout do estorno não quebra nenhum, já que nenhum teste deixa o estorno lento.

## Os pares (formato provisório)

Uma linha por par, `{ id, kind, prompt, chosen, rejected, provenance }`, com o texto em pt-BR:

- **`correção`:** o `prompt` é a rota, as operações em ordem, o achado e o código vulnerável; o `chosen` é o código da versão que aguentou; o `rejected`, o código que ainda dá achado. O `chosen` nunca é um mutante: ele aguentou aquela falha, mas tem o defeito que a mutação pôs.
- **`diagnóstico`** (`provenance.weak: true`): o `prompt` é a rota e o código; o `chosen` é a falha que deu achado, com a invariante; o `rejected`, uma falha que aguentou na mesma rota. É fraco porque "aguentou" não prova que a rota é segura.
- `provenance` traz a família, a hipótese, a rota, os ids dos dois registros e as variantes.

Esse formato é um ponto de partida. Se o de vocês for outro, só o `dpoPairs` (`packages/agent/src/chaos/dataset-pairs.ts`) muda; o dataset continua o mesmo.

## O que há hoje (2026-10-31)

| Projeto | Variante | Licença | Achados | Aguentou | Inválidos |
|---|---|---|---|---|---|
| checkout-express | original | — | 6 | 0 | 0 |
| checkout-express-fixed | fixed | — | 0 | 4 | 1 |
| checkout-express-fixed | 4 mutantes | — | 4 | 15 | 3 |
| pg-crud (`manfraio/rest_api_with_nodejs_and_postgres`) | original | ISC | 1 | 1 | 0 |

São **35 registros** (~13 KB cada) e **19 pares** (6 de correção, 13 de diagnóstico). Os exemplos deste repositório ainda não têm licença declarada. O realworld e o prisma-express entram quando o banco de teste do Prisma estiver na `main`.

## Limites

- **Alcance:** Express + `pg`/Prisma + `fetch`/`axios`, em JS/TS. O MVP acrescenta Fastify e NestJS. C# e Java têm mapa e rotas, mas não têm caos.
- **Volume:** são dezenas de registros, não milhares. A mutação aumenta os pares, mas cada mutante custa uma execução do caos (~15 s).
- **Catálogo fixo:** `timeout`, `http_5xx_intermittent`, `malformed_response`, `race_condition`, `partial_failure_after_external_call` (e `retry_storm`, sem teste no MVP).
- **Só código público ou nosso:** os `examples/` deste repositório e projetos públicos fixados por commit. Nada que o CI de um cliente publica entra no treino.

## Rastrear a geração no LangSmith (opcional)

O pipeline de caos é um grafo do LangGraph.js, e o `@langchain/core` já traz o `langsmith` como dependência (não precisa declarar na CLI). Para ver os traços, defina na máquina que gera o dataset, e só nela:

```sh
LANGSMITH_TRACING=true
LANGSMITH_API_KEY=<a chave da equipe>
LANGSMITH_PROJECT=shieldepy-dataset
```

- O traço mostra cada nó do grafo (Threat Modeler, especialistas, render) com o estado: a superfície de ataque (só fatos, sem código), as hipóteses e as specs. O código da rota não passa pelo grafo.
- As chamadas à IA usam o `LLMProvider` do ShielDepy, não os chat models do LangChain: os tokens de cada chamada não aparecem como um run de LLM no LangSmith. O custo de cada execução sai no relatório do `chaos`.
- Nunca ligue isso na extensão nem no CI de um cliente: manda a superfície de ataque para um terceiro.

## Importar

O banco é o da equipe de treino (o Neon dela), não a `apps/api`. Com a variável do envio automático, não há o que importar: os registros já chegam na tabela `shieldepy_dataset`. Sem ela, cada linha do arquivo é um JSON independente; dá para importar com `COPY` de uma coluna `jsonb`, ou com um script que lê linha a linha.

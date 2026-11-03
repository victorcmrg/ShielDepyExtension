# 0029 — Dentro de função, só o callback de registro de rota vira símbolo

**Data:** 2026-11-03 (escolha técnica, para o par real do `telemetry-tracker`) · **Estado:** valendo

**Contexto.** Um handler escrito dentro de uma função (`export async function ingestRoutes(app) { app.post('/error', async () => {...}) }`) não virava símbolo, e a rota saía sem operações. O `telemetry-tracker` tinha centenas de rotas e nenhuma operação por causa disso. O limite estava anotado na MVP4c, e vale também para o Express.

**Decisão.**
- Dentro de função, vira símbolo só o callback passado a um método registrador: `get`, `post`, `put`, `patch`, `delete`, `head`, `options`, `all`, `use`, `register` e `addHook`, direto ou embrulhado (`app.post('/x', wrap(async () => {}))`). A leitura é só pela forma: quem diz se é mesmo uma rota continua sendo a topologia, pelo pacote resolvido.
- O callback de `items.map(...)` e afins continua fazendo parte de quem o escreveu. Se todo callback virasse símbolo, as chamadas de dentro deixariam de ser do chamador, e operações sumiriam do mapa.
- O nome casa por acaso em `cache.get('k', async () => ...)`. Por isso a topologia desce nos callbacks de uma chamada, antes dela (a mesma ordem de antes), menos nos que são handler de uma rota.
- O id é o de sempre (`arquivo#app.post('/error')`, com `~2` pela ordem no arquivo), então não depende da ordem de indexação nem da linha.
- A variável capturada por um callback (`app` da função de fora) leva o `owner`, a função que a declara. Sem isso, o roteador se partia em dois valores.
- O `{ handler: async () => {} }` já era símbolo, mas o argumento não o apontava, porque o símbolo começa no par. Agora aponta.

**Consequências.**
- O `GET /api/orders/:id` do `checkout-fastify` passou a mostrar a leitura, e o limite da MVP4c deixou de valer.
- Os plugins escritos no `register` passaram a ter identidade própria, o que também tirou a multiplicação de rotas do `telemetry-tracker` (ver [`corpus-candidatos.md`](../pesquisa/corpus-candidatos.md)).
- Um ciclo que só fecha por dentro de um desses callbacks deixa de aparecer: a ligação até o callback é `references`, que não conta para ciclos.
- Callback em lista (`app.post('/x', [auth, async () => {}])`) segue sem símbolo: sai `<inline>`, sem operações.

# ShielDepy — combinados para o Claude (vale em qualquer máquina)

**Num chat novo, leia primeiro a seção "Como retomar" do [`PLANO.md`](PLANO.md)**, antes de propor qualquer coisa. Onde fica cada coisa:
- `PLANO.md`: onde estamos, as decisões pendentes e as tarefas que faltam (curto de propósito);
- `docs/decisoes/`: as decisões tomadas, uma por arquivo;
- `docs/como-funciona.md`: como o sistema funciona e o mapa do código;
- `docs/pesquisa/`: relatórios datados (custo da IA, preços e concorrência, o caos em projetos reais);
- `docs/historico/`: o plano antigo do motor e o registro até 2026-10-23, só para consulta.

## Como trabalhar
- **Responder em português (pt-BR)**, inclusive commits e o plano.
- **Fatia por fatia:** cada tarefa termina com os testes passando, o `PLANO.md` atualizado (✅ na tarefa e "Onde estamos") e **um commit** com a mudança. A mensagem do commit é o registro: diga o que mudou, por quê e como foi conferido. Mensagem em português, terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Decisão nova** (técnica ou do usuário) vira um arquivo em `docs/decisoes/` no mesmo commit, com uma linha no índice. Escolhas técnicas: decidir, registrar o porquê e avisar no resumo.
- **Branches:** a `main` é o tronco. Cada etapa sai de uma branch nova a partir da `main` e volta para ela ao terminar. Antes de começar, rodar `git fetch` e conferir se a `origin/main` andou: outra pessoa (Nicolas) também trabalha no repositório.
- **Push, PR, merge na `main` e apagar branch no GitHub:** só quando o usuário pede.
- Perguntar só o que é do usuário: gastar com a API da IA, mexer no GitHub (segredos, Releases, Marketplace), licença, provedor e hospedagem.
- **Gastar com a API da IA (chamada paga) só com autorização explícita.**
- Projetos públicos para validar o motor: clonar no scratchpad, fora do repositório, e instalar com `npm install --ignore-scripts`.

## Regras do projeto
- **Nada de regex para ler código:** só Tree-sitter ou analisador léxico. Regex em texto da IA, em caminho de arquivo ou em texto de runtime pode ([0002](docs/decisoes/0002-tree-sitter-sem-regex.md)).
- **O motor prova, a IA propõe:** toda saída da IA é validada, existe caminho offline, e um teste de caos só conta como falha se o controle (sem caos) passou ([0001](docs/decisoes/0001-motor-prova-ia-propoe.md)).
- Ligação que não dá para provar sai marcada como `heuristic` (por nome); nunca esconder isso.
- O mapa tem que dar o mesmo resultado em qualquer ordem de indexação (há um teste e o `npm run mapa:reais` para conferir).
- `apps/api` e `apps/web` não importam o motor ([0008](docs/decisoes/0008-produto-e-empresa.md)); a API segue DDD por domínio ([0013](docs/decisoes/0013-api-ddd-por-dominio.md)); regra de negócio da empresa é com TDD ([0011](docs/decisoes/0011-tdd-na-empresa.md)).
- Mudança visual (relatório, visualizador, portal): conferir em screenshot antes de dar por pronta (pedir antes de abrir o Chrome).

## Cuidado com a máquina (já deu tela azul)
- **Perguntar antes** de abrir VS Code, Chrome ou o E2E (`npm run test:e2e -w shieldepy`, `npm run demo`, `npm run demo:verificar`), de rodar suítes pesadas em paralelo ou de matar processos à força.
- Uma coisa pesada por vez; preferir checagens leves (typecheck, um arquivo de teste).
- Se um processo travar, avisar em vez de matar e relançar várias vezes. No Windows, o `tsx` do servidor pode sobreviver ao terminal: encerrar o que você subiu.

## Comandos (da raiz do repositório)
- `npm run check`: typecheck + testes unitários (465 passando em 2026-10-30).
- `npm run build:vscode`: a extensão (`dist/extension.js` ~740 KB e `dist/chaos.js` ~1,9 MB; se o primeiro crescer muito, algo puxou o LangGraph).
- `npm run cli -- graph|topology|chaos <pasta>`: o motor pela CLI. `chaos examples/checkout-express --offline [--report arq.md]` sai com 1 no vulnerável e 0 no `-fixed`.
- `npm run mapa:reais`: mede o mapa em projetos reais do GitHub (fixados por commit, fora do repositório).
- `npm run web:dev`: portal em desenvolvimento (`apps/web` no Vite em 5173, com proxy de `/api` para a `apps/api` em 3001). `npm run web`: build do site + API servindo tudo em 3001. Na extensão, `"shieldepy.webBaseUrl"` aponta para um dos dois. Para testes, o banco vai para uma pasta temporária com `SHIELDEPY_DATA_DIR`. Primeiro admin: `npm run bootstrap -w @shieldepy/api` (com `ADMIN_EMAIL` no `.env`).
- Banco da API: Postgres com Drizzle ([0015](docs/decisoes/0015-drizzle.md)). Sem `DATABASE_URL`, PGlite em `apps/api/data/pglite` (ou `SHIELDEPY_DATA_DIR/pglite`). `npm run db:migrate -w @shieldepy/api` aplica as migrations pendentes (a API também aplica ao subir); depois de mudar o `schema.ts`, `npm run db:generate -w @shieldepy/api` gera a próxima. Dados de demo: `npm run seed:demo -w @shieldepy/api`.
- `npm run package:vscode`: gera o `.vsix`.
- `npm run estimate:chaos` (grátis) e `npm run measure:chaos -- --sim-gastar` (pago: só com autorização).
- Windows: os caminhos têm acento e espaço (`Área de Trabalho`), use aspas. Os arquivos estão em CRLF; edições por script que procuram `\n` podem não casar (prefira o editor).

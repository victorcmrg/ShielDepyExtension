# ShielDepy — TCC

O ShielDepy é um plugin do VS Code (com CLI e portal web) que **lê o código sem executar nada**,
monta o grafo do sistema, acha as rotas que fazem operações arriscadas (banco de dados e APIs
externas) e **gera testes de caos só para elas**: corrida entre requisições, API lenta, fora do ar ou
respondendo lixo, e o banco caindo depois de a API cobrar. No pull request, ele barra o código que
quebra sob essas falhas. A IA é opcional: ela propõe e explica, e o motor prova.

```
ShielDepyExtension/
├── packages/     ← o motor: core, extractors, agent (IA), viewer (o mapa)
├── apps/         ← vscode (o plugin), cli, api (contas e portal), frontend (site e portal)
├── examples/     ← sistemas de exemplo usados nos testes e na demo
├── docs/         ← como funciona, decisões, pesquisa e histórico
└── PLANO.md      ← o que está sendo feito agora e o que vem depois
```

## Ver funcionando (demo para a apresentação)

**Precisa de:** [Node.js 22.6 ou mais novo](https://nodejs.org), [git](https://git-scm.com) e o
[VS Code](https://code.visualstudio.com). Windows, Linux ou macOS.

```bash
git clone https://github.com/victorcmrg/ShielDepyExtension.git
cd ShielDepyExtension
npm run demo
```

Na primeira vez, ele instala e compila tudo (alguns minutos). Depois:

1. cria, **fora do repositório** (em `ShielDepy-demo`, na sua pasta de usuário), um **sistema de exemplo** (uma loja) com defeitos plantados:
   - `checkout/`: API Express com Postgres e Stripe;
   - `pedidos/`: microserviços que disputam o mesmo campo;
   - `relatorios/`: dois módulos em ciclo;

   e as branches `main` (com os defeitos) e `correcao`;
2. sobe o **portal** em <http://localhost:3001> (login `dono@acme.test` / `Acme-Dono-2026`);
3. roda os testes de caos nas duas branches só para o **histórico do portal** (como se o CI tivesse rodado);
4. abre esse sistema numa **janela nova do seu VS Code com o plugin ativado** (a "[Extension Development Host]": nada é instalado no seu VS Code), já logado, com o
   **`ROTEIRO.md`** aberto.

**Quem comanda é o plugin.** No painel do escudo (barra da esquerda) ficam dois botões:
- **◇ Ver grafo do sistema**: abre o mapa (rotas, controller → service → repositórios → banco e APIs);
- **⚡ Rodar testes de caos**: gera e roda os testes (com progresso e log na Saída → ShielDepy), acusa
  cada falha como erro na **Lista de erros** e no **Problems**, na linha do código atingida, e abre o
  **grafo final** com o que quebrou marcado em vermelho.

O `ROTEIRO.md` é o passo a passo da apresentação: os botões, as colisões, o ciclo, a correção
(`git switch correcao` e ⚡ de novo) e o portal.

Se o VS Code perguntar se você confia nos autores da pasta, clique **"Sim, confio"**. Deixe o terminal aberto enquanto apresenta (ele mantém o portal no ar). **Ctrl+C** encerra.

| Comando | O que faz |
|---|---|
| `npm run demo` | prepara e abre a demo |
| `npm run demo -- --do-zero` | apaga a demo e recria do zero |
| `npm run demo:verificar` | confere o roteiro inteiro sem abrir janela e encerra tudo no fim (uns 3 min); bom para rodar antes da apresentação |
| `npm run demo:caos` | roda os testes de caos de novo no sistema da demo, na branch atual (dentro do VS Code da demo, o mesmo é `npm run caos`) |

Variáveis opcionais (no PowerShell: `$env:DEMO_PORT=3002; npm run demo`; no bash: `DEMO_PORT=3002 npm run demo`):
- `DEMO_PORT`: outra porta, se a 3001 estiver ocupada;
- `VSCODE_BIN`: o executável do VS Code, se ele não for encontrado;
- `DEMO_ZOOM=1`: letras maiores, para o projetor;
- `DEMO_DIR`: outra pasta para a demo (o padrão é `ShielDepy-demo` na sua pasta de usuário).

Para apagar a demo, apague a pasta `ShielDepy-demo`. O `npm run demo -- --do-zero` faz isso e recria tudo.

## Para desenvolver

O [`docs/como-funciona.md`](docs/como-funciona.md) explica como o sistema funciona, onde fica
cada coisa e como rodar os testes:

```bash
npm install && npm run check     # F5 no VS Code abre a extensão em desenvolvimento
```

## Estado

Concluído, etapa por etapa (detalhes em [`PLANO-CHAOS.md`](PLANO-CHAOS.md)):

- **E1:** o grafo do código, com cobertura;
- **E2:** a topologia (rotas, operações de I/O e tags de risco);
- **E3:** hipóteses de falha (motor + IA) e testes gerados por templates;
- **E4:** execução com controle, portão no CI e comentário no PR;
- **E5:** só o que o PR tocou, e o custo;
- **V1–V3:** o mapa interativo e o portal com o histórico;
- **E6:** a falha no banco depois da chamada externa (DB_Chaos).

- **L:** C# no mapa completo (ASP.NET Core, EF Core, Dapper, MediatR), com o exemplo `pedidos-aspnet`;
- **J:** Java no mapa completo (Spring MVC, Spring Data JPA, JdbcTemplate, clientes HTTP), com o exemplo `pedidos-springboot`.

O caos (os testes gerados) continua só para JS/TS; C# e Java têm o mapa, as rotas e as operações de risco.

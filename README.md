# ShielDepy — TCC

O ShielDepy é um plugin do VS Code (com CLI e portal web) que **lê o código sem executar nada**,
monta o grafo do sistema, acha as rotas que fazem operações arriscadas (banco de dados e APIs
externas) e **gera testes de caos só para elas**: corrida entre requisições, API lenta, fora do ar ou
respondendo lixo, e o banco caindo depois de a API cobrar. No pull request, ele barra o código que
quebra sob essas falhas. A IA é opcional: ela propõe e explica, e o motor prova.

```
ShielDepyExtension/
├── shieldepy_p1/           ← o sistema (plugin, CLI, portal, motor e exemplos)
├── PLANO-CHAOS.md          ← o plano e o registro de cada etapa
└── RELATORIO-CUSTO-IA.md   ← quanto a IA custa por execução
```

## Ver funcionando (demo para a apresentação)

**Precisa de:** [Node.js 22.6 ou mais novo](https://nodejs.org), [git](https://git-scm.com) e o
[VS Code](https://code.visualstudio.com). Windows, Linux ou macOS.

```bash
git clone https://github.com/victorcmrg/ShielDepyExtension.git
cd ShielDepyExtension/shieldepy_p1
npm run demo
```

Na primeira vez, ele instala e compila tudo (alguns minutos). Depois:

1. cria um **sistema de exemplo** (uma loja) com defeitos plantados:
   - `checkout/`: API Express com Postgres e Stripe;
   - `pedidos/`: microserviços que disputam o mesmo campo;
   - `relatorios/`: dois módulos em ciclo;

   e as branches `main` (com os defeitos) e `correcao`;
2. sobe o **portal** em <http://localhost:3001> (login `dono@acme.test` / `Acme-Dono-2026`);
3. roda os **testes de caos** nas duas branches e publica o resultado no portal;
4. abre o **VS Code com o plugin**, já logado, num perfil separado (não mexe no seu VS Code), com o
   **`ROTEIRO.md`** aberto: o passo a passo do que clicar em cada aba do plugin para ver o grafo, as
   colisões, o ciclo, o caos, a correção e o portal.

Deixe o terminal aberto enquanto apresenta (ele mantém o portal no ar). **Ctrl+C** encerra.

| Comando (em `shieldepy_p1/`) | O que faz |
|---|---|
| `npm run demo` | prepara e abre a demo |
| `npm run demo -- --do-zero` | apaga a demo e recria do zero |
| `npm run demo:verificar` | confere o roteiro inteiro sem abrir janela e encerra tudo no fim (uns 3 min); bom para rodar antes da apresentação |
| `npm run demo:caos` | roda os testes de caos de novo no sistema da demo, na branch atual (dentro do VS Code da demo, o mesmo é `npm run caos`) |

Variáveis opcionais (no PowerShell: `$env:DEMO_PORT=3002; npm run demo`; no bash: `DEMO_PORT=3002 npm run demo`):
- `DEMO_PORT`: outra porta, se a 3001 estiver ocupada;
- `VSCODE_BIN`: o executável do VS Code, se ele não for encontrado;
- `DEMO_ZOOM=1`: letras maiores, para o projetor.

## Para desenvolver

O [README do `shieldepy_p1`](shieldepy_p1/README.md) explica como o sistema funciona, onde fica
cada coisa e como rodar os testes:

```bash
cd shieldepy_p1 && npm install && npm run check     # F5 abrindo a pasta shieldepy_p1
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

A **E7** (outras linguagens) está parada.

# 0034 — Um projeto de caos por `package.json`

**Data:** 2026-11-06 (teste do usuário na extensão) · **Estado:** valendo

**Contexto.** Abrindo o repositório inteiro, a extensão oferecia a raiz como projeto de caos, com 4 rotas: as de `examples/pedidos-aspnet` e `examples/pedidos-springboot`, que não têm `package.json`, então a busca subia até a raiz. E o `--init` na raiz lia a pasta toda: juntou as rotas dos 4 `checkout-*`, com chaves repetidas em `requests` e o `createApp` de um app só.

**Decisão.**
- **A subpasta com `package.json` de projeto é outro projeto.** O caos não entra nela: nem o `--init`, nem a execução, nem o mapa da base no `--base`, nem as regras. Os quatro leem a mesma árvore (`projectTree`), senão o contrato e os testes enxergariam coisas diferentes.
- **É projeto o `package.json` com `name`, dependências, `scripts` ou `workspaces`.** Só com `"type": "module"`, ele é configuração de pasta. A extensão usa a mesma regra para achar o projeto de uma rota.
- **Rota de C# ou Java não conta para a lista de projetos da extensão,** porque o caos não a alcança.
- **Pasta sem rota própria e com subprojetos: o caos sai 2 e lista as subpastas,** sem criar contrato. Zero testes ali não é um verde.

**Consequências.**
- O `shieldepy graph`, o `topology` e o `diff` seguem lendo a pasta inteira: o mapa de um repositório mostra tudo, e só o caos testa um app por vez.
- Um app que importa código de um pacote irmão perde as operações de lá, como já acontecia ao rodar o caos dentro de `apps/api` num monorepo: o limite é a pasta do projeto.

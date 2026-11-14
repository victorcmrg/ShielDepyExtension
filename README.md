# Branch de deploy da Square Cloud

O site e o portal do ShielDepy rodando de verdade: a API (`src/`, copiada de `apps/api/src`) serve o build do
site (`public/`) e guarda as contas no PGlite em `data/`. Gerado por `scripts/squarecloud/montar.mjs` na `main`
(decisão 0048). Não edite aqui: o código-fonte fica na `main`.

Variáveis no painel da Square Cloud:
- `ADMIN_EMAIL` e `ADMIN_INITIAL_PASSWORD` (8+ caracteres): o admin da plataforma, criado na primeira subida.
- Opcionais: `DATABASE_URL` (Postgres em vez do PGlite), `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`,
  `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` e `OAUTH_REDIRECT_BASE` (login social).

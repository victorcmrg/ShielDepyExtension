# 0048 — O site e o portal no ar na Square Cloud

**Data:** 2026-11-13 (pedido do usuário: subir para a Square Cloud "com a parte pós login") · **Estado:** valendo

**Contexto.** Desde 2026-11-11 a Square Cloud servia só a landing estática, numa branch `squarecloud` sem histórico com a `main` (o build do `apps/web`, com o `app.html` copiado em `entrar/index.html` para o `/entrar` abrir). Login, empresas e projetos não existiam no ar: eles dependem da `apps/api`. A Square Cloud não tem terminal para rodar o `npm run bootstrap`, e o primeiro admin só nascia assim (ou por login social, que não está configurado lá).

**Decisão.**
- **A Square Cloud roda a API, que serve o site.** A branch `squarecloud` passa a ser um pacote Node montado por `npm run squarecloud:montar -- <pasta>` (`scripts/squarecloud/montar.mjs`): `src/` (cópia de `apps/api/src`; a API não importa o motor, [0008](0008-produto-e-empresa.md)), `drizzle/` (as migrations), `public/` (o build do site), um `package.json` só com as 4 dependências da API nas versões instaladas aqui, o `start.mjs` e o `squarecloud.app` (`MAIN=start.mjs`, `START=node --import tsx start.mjs`, 512 MB, subdomínio `shieldepy`). Não se instala o monorepo lá.
- **O `start.mjs` põe os padrões do host:** porta 80, `NODE_ENV=production`, o site em `public/`, o banco em `data/` e `PUBLIC_URL=https://shieldepy.squareweb.app`. Variáveis do painel passam por cima.
- **Banco: PGlite em `data/`, escolha do usuário.** Sem custo nem configuração; trocar por Postgres é só pôr `DATABASE_URL` no painel ([0015](0015-drizzle.md)). O `data/` fica fora do git da branch (`.gitignore`) e o montador não o apaga.
- **O admin nasce das variáveis de ambiente.** O `start:prod` da API (`src/scripts/startProd.ts`) chama `bootstrapAdmin` antes de subir o servidor: com `ADMIN_EMAIL` (e `ADMIN_INITIAL_PASSWORD`, 8+ caracteres), cria a empresa "ShielDepy (admin)" com IA liberada e o convite do dono com a senha inicial; nas subidas seguintes, o admin já existe e nada muda, nem a senha. O `npm run bootstrap` manual usa a mesma função. A senha vai no painel da Square Cloud, pelo usuário, nunca no repositório.
- **O login de teste fica desligado no ar** (escolha do usuário, como a [0047](0047-login-de-teste-no-entrar.md) já mandava): com `NODE_ENV=production`, `/api/auth/test-login` dá 404. No ar, o "Entrar" funciona com e-mail e senha.

**Consequências.**
- O `/entrar` e as rotas do portal saem do fallback da API (`app.html`), sem a cópia em `entrar/index.html`.
- **Risco:** se a Square Cloud substituir a pasta inteira num deploy pelo GitHub, o `data/` (contas e empresas) se perde. Para dados que precisam durar, `DATABASE_URL` com um Postgres.
- Login social (Google/GitHub) só com as chaves e o `OAUTH_REDIRECT_BASE` no painel.
- Atualizar o site: `npm run squarecloud:montar -- <clone da branch squarecloud>`, commit e push da branch; a Square Cloud refaz o deploy sozinha a cada push.

# 0047 — O "Entrar" encenado entra de verdade, e sem e-mail e senha no ambiente de teste

**Data:** 2026-11-13 (pedido do usuário: a tela de login de teste deve levar à tela "oficial" de empresas depois do login, e o e-mail e a senha podem ficar vazios) · **Estado:** valendo

**Contexto.** A tela final do `/entrar` ([0039](0039-entrar-encenado.md)) era mockada: o botão só mostrava um aviso e mandava para o `/login`. O painel de empresas é o `/admin` ("Plataforma"), só para o admin da plataforma (`ADMIN_EMAIL`). Nesta máquina não há `.env`, então ninguém é admin.

**Decisão.**
- **A tela final entra de verdade.** Com e-mail e senha, usa o login do portal (`/api/auth/login`). Com os dois vazios, usa o login de teste. Depois do login, o admin vai para o `/admin` e os outros para os projetos.
- **Login de teste:** `POST /api/auth/test-login`, sem corpo. Só existe com `SHIELDEPY_TEST_LOGIN=1` e fora de `NODE_ENV=production` (`testLoginEnabled`); desligado, responde 404. Ele abre a sessão da conta `teste@shieldepy.test` e, na primeira vez, cria a empresa dela, "ShielDepy (teste)", com IA. A conta é admin da plataforma **só enquanto a chave está ligada** (`isPlatformAdmin` recebe esse terceiro argumento): ao desligar, a sessão continua, mas o `/admin` passa a dar 403.
- **Quem liga:** o `npm run web:dev` (`apps/web/scripts/dev.mjs`). O `npm run web` e produção não ligam. A chave está documentada no `.env.example`, com o aviso de nunca usar num servidor público.
- **Testes primeiro** ([0011](0011-tdd-na-empresa.md)): a regra e o caso de uso em `identity.domain.test.ts`, e a rota contra o banco em `portal.test.ts` (404 desligada, admin ligada, sem duplicar a empresa, 404 em produção e o admin perdido ao desligar).

**Consequências.**
- No `web:dev`, o banco local ganha a empresa "ShielDepy (teste)" no primeiro login de teste. Para ver mais empresas no painel: `npm run seed:demo -w @shieldepy/api`.
- O `/login` continua igual (extensão, OAuth e redirecionamento entram por ele).
- Se alguém ligar `SHIELDEPY_TEST_LOGIN=1` num servidor exposto sem `NODE_ENV=production`, qualquer um entra como admin. Por isso a chave fica fora do `.env` padrão e só o script de desenvolvimento a liga.

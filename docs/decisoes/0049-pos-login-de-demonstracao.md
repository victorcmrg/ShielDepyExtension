# 0049 — O pós-login de demonstração no site estático

**Data:** 2026-11-13 (pedido do usuário: "após o clique de login é para colocar a tela de empresas conectadas, funcionários, mas tudo mockado, sem sistema rodando por trás") · **Estado:** valendo

**Contexto.** O site da Square Cloud é um app estático (não vira Node depois de criado, [0048](0048-portal-na-square-cloud.md)). Sem a API, o botão da tela final do `/entrar` chamava o login e não ia a lugar nenhum. O usuário quer, no site público, um pós-login de mentira.

**Decisão.**
- **A rota `/demo` do portal** (`pages/Demo.tsx`) é o painel de empresas com o visual do portal (menu lateral, cartões de números, "Conectados agora", linhas de empresa com os funcionários), com uma faixa dizendo que é demonstração. Os dados ficam em `portal/demo/data.ts`, só dados e contas puras (testadas): 4 empresas de exemplo com funcionários, e-mails em domínios reservados (`.test`); os números e quem está conectado (VS Code visto nos últimos 15 min, empresa liberada) saem da própria lista. Os interruptores (acesso e IA) e a busca só mudam a tela; nada é salvo.
- **O modo é do build:** `VITE_DEMO_PORTAL=1` (`portal/demo/mode.ts`). Ligado, o "Entrar" vai para `/demo` sem chamar a API, o `/login` vira a encenação e qualquer outra rota do portal vira a demonstração. Desligado (o `web:dev`, a API servindo o site), tudo funciona como antes ([0047](0047-login-de-teste-no-entrar.md)).
- **O montador da Square Cloud tem dois modos** (`npm run squarecloud:montar -- <pasta>`): o padrão é o site estático com a demonstração (o build com a marca; o `app.html` copiado em `entrar/`, `demo/` e `login/`, para abrir direto e depois de um reload); `--portal` monta o pacote Node da 0048.

**Consequências.**
- O site público mostra o produto depois do login sem expor nada: não há conta, banco nem API por trás.
- O portal de verdade segue pronto na branch `squarecloud-portal`, para quando houver um app em Node.

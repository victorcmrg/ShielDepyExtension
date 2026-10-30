# 0017 — Da empresa, só o necessário para distribuir o produto

**Data:** 2026-10-30 (escolha do usuário) · **Estado:** valendo · **Ajusta:** a ordem das etapas do `PLANO.md` (W, G e P vêm antes de A e B, e só no mínimo)

**Contexto.** A meta é pôr o site da empresa no ar e distribuir a extensão. Licença e cobrança (A e B) só fazem sentido quando houver quem pague. Um full stack completo da empresa (cadastro self-service, planos, faturas, operação madura) atrasaria o lançamento sem ninguém usando o produto. A extensão já funciona sem conta: o motor é local e grátis ([0005](0005-modo-local-gratis.md)).

**Decisão.**
- Da parte da empresa, entra só o necessário para distribuir: o site honesto, a extensão nos marketplaces e, num segundo degrau, o portal e a API no ar para os primeiros times. Tudo o que não serve a isso fica para depois.
- **Degrau 1 (lançar):** a landing honesta (W) como site estático, o aviso de "framework não suportado" (C2f), a versão e o changelog (G1), a extensão sem o login apontando para localhost, os termos e a privacidade, e a publicação no Marketplace e no Open VSX (G4). Sem servidor.
- **Degrau 2 (portal no ar):** o deploy da API, que já serve o site (P2), o mínimo de segurança (P3), backup e logs (P4 no básico). Os times entram pelo admin; o cadastro self-service fica para a B.
- **Fica para depois:** a CLI no npm (G2), o `.vsix` nas Releases (G3), o workflow de release automático (G5), a licença (A), a cobrança (B) e a operação completa.

**Consequências.**
- A ordem do plano passa a ser: C (até a C2f) → degrau 1 → degrau 2 → resto da C → A → B.
- O degrau 1 depende de DP4 (domínio e e-mail) e de saber se o repositório fica privado (DP2: o Marketplace aceita repositório privado). O degrau 2 depende de DP3 (hospedagem).
- Nada aqui muda o motor nem a regra "a API não importa o motor" ([0008](0008-produto-e-empresa.md)).

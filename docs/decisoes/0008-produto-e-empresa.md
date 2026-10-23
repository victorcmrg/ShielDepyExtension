# 0008 — Produto e empresa separados no mesmo monorepo

**Data:** 2026-10-23 · **Estado:** valendo

**Contexto.** O backend da empresa estava dentro do pacote do site e carregava o motor (Tree-sitter e IA) para servir `/analyze` e `/chat`. Qualquer mudança de cobrança mexeria no pacote que roda o motor.

**Decisão.**
- **Produto** (vai para a máquina do cliente): `packages/*`, `apps/vscode`, `apps/cli`.
- **Empresa**: `apps/api` (contas, projetos, tokens, execuções de caos, licenças, cobrança) e `apps/web` (landing e portal, só front).
- `apps/api` e `apps/web` **não dependem** de `core`, `extractors`, `agent` nem `viewer`. Um teste garante isso (S4).
- O produto só conhece a empresa pela URL do portal (`shieldepy.webBaseUrl`) e pelo `packages/license`.
- A chave privada de qualquer assinatura fica só na API, em variável de ambiente.
- Separar em dois repositórios só se o produto virar open source ou se outra equipe cuidar da empresa.

**Consequências.** As etapas S1–S7 do `PLANO.md`.

# 0001 — O motor prova, a IA propõe

**Data:** 2026-10-07 · **Estado:** valendo

**Contexto.** A IA inventa com facilidade, e uma ferramenta que barra PR não pode ter falso positivo inventado.

**Decisão.**
- Toda saída da IA é validada pelo motor determinístico antes de ser usada.
- Sempre existe caminho offline: sem chave de API, o produto funciona com o motor sozinho.
- Um teste de caos só conta como falha se o **controle** (a mesma rota, sem caos) passou.

**Consequências.** A IA é opcional e só sugere: hipóteses, explicações, texto do relatório. Recurso novo que dependa da IA precisa de um caminho determinístico ou de validação equivalente.

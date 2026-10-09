# O motor prova, sem conta e sem IA

Ao abrir um projeto JavaScript ou TypeScript, o ShielDepy lê o código com Tree-sitter e monta o mapa sozinho. Não precisa de configuração.

**O que aparece:**

- **Ciclos de chamada:** `a.ts` chama `b.ts`, que chama `a.ts` de volta.
- **Colisões:** dois lugares gravam o mesmo campo no mesmo evento, ou um lê o que o outro acabou de escrever.

**Onde aparece:**

- no painel **Problems**;
- no **Explorer**, com uma forma por severidade: ■ importante, ▲ atenção, ● leve;
- na **lista de erros** do ShielDepy, na barra lateral.

Tudo roda nesta máquina. Um achado só aparece quando o motor consegue provar.

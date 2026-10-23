# ShielDepy — combinados para o Claude (vale em qualquer máquina)

O estado do trabalho fica em dois planos. **Num chat novo, leia primeiro a seção "Como retomar num chat novo"** do plano da etapa atual, antes de propor qualquer coisa:
- `PLANO.md`: o produto e a empresa (separação `apps/api`/`apps/web`, distribuição, licença, cobrança, produção) e o resto do caos;
- `PLANO-CHAOS.md`: o motor (grafo, linguagens, topologia, caos), com o Registro detalhado.

## Como trabalhar
- **Responder em português (pt-BR)**, inclusive commits e o plano.
- **Fatia por fatia:** cada fatia termina com os testes passando, o plano atualizado (registro + ✅ na tarefa) e **um commit** com a mudança. Mensagem em português, terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Push:** só quando o usuário pede (ele sincroniza entre máquinas). Nunca abrir PR nem fazer merge na `main` sem ele pedir.
- Escolhas técnicas: decidir, registrar o porquê no plano e avisar no resumo. Perguntar só o que é do usuário (gastar com a API da IA, mexer no GitHub, licença).
- **Gastar com a API da IA (chamada paga) só com autorização explícita.**

## Regras do projeto
- **Nada de regex para ler código:** só Tree-sitter ou analisador léxico. Regex em texto da IA, em caminho de arquivo ou em texto de runtime pode.
- **O motor prova, a IA propõe:** toda saída da IA é validada, existe caminho offline, e um teste de caos só conta como falha se o controle (sem caos) passou.
- Ligação que não dá para provar sai marcada como `heuristic` (por nome); nunca esconder isso.
- O mapa tem que dar o mesmo resultado em qualquer ordem de indexação (há um teste e o `npm run mapa:reais` para conferir).

## Cuidado com a máquina (já deu tela azul)
- **Perguntar antes** de abrir VS Code, Chrome ou o E2E (`npm run test:e2e`, `npm run demo:verificar`), de rodar suítes pesadas em paralelo ou de matar processos à força.
- Uma coisa pesada por vez; preferir checagens leves (typecheck, um arquivo de teste).
- Se um processo travar, avisar em vez de matar e relançar várias vezes.

## Comandos (de `shieldepy_p1/`)
- `npm run check`: typecheck + testes unitários.
- `npm run build:vscode`: a extensão (`dist/extension.js` ~680 KB; se crescer muito, algo puxou o LangGraph).
- `npm run cli -- graph|topology|chaos <pasta>`: o motor pela CLI.
- `npm run mapa:reais`: mede o mapa em projetos reais do GitHub (fixados por commit, fora do repositório).
- Windows: os caminhos têm acento e espaço (`Área de Trabalho`), use aspas. Os arquivos estão em CRLF; edições por script que procuram `\n` podem não casar (prefira o editor).

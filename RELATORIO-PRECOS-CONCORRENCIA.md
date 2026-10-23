# Relatório de preços e concorrência do ShielDepy

**Data:** 2026-10-16 · **Base:** branch `feat/caos-utilizavel` (`3799732`, C1 parcial) · **Preços da concorrência:** páginas acessadas em 2026-10-16 · **Câmbio:** R$ 5,03 por dólar (comercial de 14/10/2026) + IOF de 3,5% · **Planos avaliados:** `apps/frontend/src/landing/sections/Pricing.tsx`

## 1. Resumo

- **Hoje não dá para cobrar.** Não há cadastro, cobrança, modelo de plano nem limite no código. "Assinar" leva a `/login`, o portal não está publicado e o `.vsix` e a CLI não estão distribuídos (Engenheiro, riscos 1, 2 e 7).
- **Quem paga recebe o mesmo que quem não paga.** O modo local grátis entrega tudo o que o Starter vende. Com a chave do próprio usuário (BYOK), entrega também a IA do Completo (Engenheiro, itens 10 e 26).
- **O diferencial é único, mas estreito.** Nenhum concorrente levantado gera caos a partir da topologia nem prova colisão de escrita entre handlers. Só que o caos roda apenas em Express + pg/Prisma + fetch/axios, e com contrato manual. E a landing não fala de caos.
- **Na prática, o comprador compara com o orçamento de "qualidade no PR".** A âncora é o grátis (SonarQube Cloud Free, Semgrep até 10 devs) e o assento de IA a ~R$ 99–125 por dev (Copilot Business, CodeRabbit Essentials).
- **Veredito por plano:** formalizar o **Local grátis** (já existe), **reestruturar o Starter e o Completo** em torno do que a conta traz (portal, equipe, histórico, portão no CI), **manter o Completo em R$ 249** como preço de lançamento e só subir para os R$ 349–449 do Economista depois de validar com 5–10 times. **Adiar o Business**, e manter o **Enterprise sob consulta**, com dois itens marcados "em breve".
- **Tirar da landing ou marcar "em breve"** 8 promessas, entre elas duas de segurança que contradizem o código ("só funciona no repo do seu projeto" e "trava em até 1 minuto").
- **Proposta de roadmap:** puxar a C4 (CI de verdade) para logo depois da C1, criar uma tarefa de honestidade da landing e um aviso de "framework não suportado" antes do release (C5), e abrir uma etapa nova de monetização (**M**) depois do release, antes de cobrar o primeiro real.

## 2. Como foi feito

Três agentes, em 2026-10-16, sem alterar o repositório (`git status` limpo ao final):

| Agente | O que fez | Arquivo |
|---|---|---|
| Engenheiro | Conferiu 26 promessas de venda contra o código. Rodou `npm run check` e a CLI (`cycles`, `graph`, `topology`, `chaos --offline`, `report --fail-on`) e montou a matriz de features | `eng.md` |
| Economista | Levantou os preços de 25+ produtos em páginas oficiais [O] e de terceiros [T], normalizou para times de 3/10/30 devs e calculou margem, ROI e câmbio | `eco.md` |
| Gestor (este) | Cruzou os dois, conferiu `Pricing.tsx` e o `PLANO-CHAOS.md` (seções "Como retomar" e "C") e escreveu as recomendações | este relatório |

**Premissas do Economista:** câmbio de R$ 5,03 (InfoMoney, 14/10/2026) e IOF de 3,5%. O spread do cartão (~5%, câmbio de cartão de ~R$ 5,30) **não** entra nas tabelas. O dev custa R$ 90/h no cenário central (faixa de R$ 60 a R$ 155). O Simples é 6% no Anexo III ou 15,5% no Anexo V.

**Limites:**
- Nenhuma chamada paga à IA.
- Não foram rodados: o E2E da extensão, o `npm run web`, o `report --pg` contra um banco real e o workflow no GitHub Actions (seção 9).
- A comparação com a concorrência é **por categoria**. Os recursos dos concorrentes não foram testados, só os preços foram lidos.
- Atenção ao câmbio: o `RELATORIO-CUSTO-IA.md` usa R$ 5,50, e este relatório usa R$ 5,03. Os valores de IA em R$ aqui vêm do Economista, já a R$ 5,03.

## 3. O que o ShielDepy entrega hoje

Fonte: `eng.md`, seção 1 (26 promessas), condensada. Caminhos relativos à raiz do repositório (na época, a pasta `shieldepy_p1/`).

| Promessa | Plano | Status | Evidência |
|---|---|---|---|
| Extensão para VS Code | Starter | Entrega, mas sem distribuição | `.vsix` gerado; não está publicado no Marketplace nem nas GitHub Releases |
| Ciclos provados sem IA | Starter | Entrega (só TS/JS) | `cycles` acha a→b→a, **mas sai com exit 0** (não serve de portão) |
| Colisões provadas sem IA | Starter | Entrega | `report … --fail-on critico`: 3 colisões, exit 1. A `condition` das regras não é avaliada |
| "1 projeto, até 3 pessoas" | Starter | **Não existe** | `projectRoutes.ts:86-91,152-162` não contam nada; `companies` não tem plano |
| CLI local | Starter | Parcial | `apps/cli/package.json`: `"private": true`. Só roda clonando o monorepo |
| Projetos e pessoas ilimitados | Completo | "Entrega" por omissão | Não há limite para ninguém |
| IA: explicações, chat, correção verificada | Completo | Entrega, com **BYOK** | `AiService.ts:67-68`: a chave é do usuário. Validada só com provedor falso |
| IA restrita ao Completo | Completo | **Não existe** | `AuthService.ts:130-133`: sem conta, a IA fica liberada com a chave própria |
| Portão no CI | Completo | Parcial | `chaos` exit 1/0 local. O workflow **nunca rodou no Actions**. O template não roda o `report --fail-on` que a landing mostra, e depende do repo `victorcmrg/...` ser público |
| Painel de uso por repositório | Completo | Parcial | Portal **não publicado**. O "uso" é só último acesso e pessoas em 24 h |
| Triggers do Postgres em produção | Enterprise | Parcial | `connect.ts` sem teste contra banco real. Leitura pontual, sem gating |
| Implantação no seu ambiente | Enterprise | **Não existe** | Sem Docker, compose ou guia |
| Suporte dedicado / "Falar com o time" | Enterprise | **Não existe** | `#contato` leva a um rodapé sem e-mail nem formulário |
| Assinar / mensal-anual −20% | Planos | **Não existe** / só visual | Sem billing no `server/` (grep vazio). A empresa só é criada pelo admin |
| "Seis linguagens" | Landing | Parcial | Fora de TS/JS, só colisões (Spring, Django, MediatR). Ciclos, mapa e caos são só TS/JS |
| "Só funciona no repo do seu projeto" | Landing | **Contradiz o código** | `extension.ts:122`: o motor roda sem conta, em qualquer repo |
| "Suspender trava em até 1 min" | Landing | **Contradiz o código** | A suspensão só desliga a IA (`AuthService.ts:21,133`) |
| Chave de IA fica com você; senhas com scrypt | Landing | Entrega | `AiService.ts`, `passwords.ts` |
| SSO | Implícito | Parcial | Só Google e GitHub (`oauth.ts:7`), sem SAML/OIDC nem SCIM |
| **Caos gerado pela topologia** | **Ausente da landing** | Entrega em Express + pg/Prisma + fetch/axios | `checkout-express`: 4 achados, exit 1; `-fixed`: exit 0. Fastify: **0 rotas**, "nada a testar" |
| Mapa e topologia | README | Entrega (só TS/JS) | `graph`: 100% das chamadas provadas no exemplo |
| Modo local grátis | Decisão do PLANO | Entrega e **canibaliza os planos** | `extension.ts:122` |

**Comandos** (`eng.md`, seção 2): `npm run check` passou (330 testes, 0 pulados). `chaos` deu exit 1 no vulnerável e 0 no `-fixed`, como esperado, e a IA não foi chamada (custo zero).

## 4. Preços da concorrência

Fonte: `eco.md`, seção 1, condensada. R$ = US$ × 5,03 × 1,035. Páginas acessadas em 2026-10-16. [O] = página oficial, [T] = terceiro.

| Produto | Categoria | Plano pago de entrada | Unidade | R$/mês com IOF | Porta grátis | Fonte |
|---|---|---|---|---|---|---|
| SonarQube Cloud | Estática/qualidade | Team, US$ 34 (o FAQ diz 32) | fixo até 100k LOC | ~177 | Free até 50k LOC | [O] [15] |
| Codacy | Estática/qualidade | Team, US$ 18 (anual) / 21 | por dev | 94 / 109 | Developer | [O] [16] |
| DeepSource | Estática + IA | Team, US$ 24 (anual) | por usuário | 125 | OSS | [O] [17] |
| CodeScene | Qualidade comportamental | Standard, €18 (anual) | por autor ativo | 106 | OSS | [O] [18] |
| Semgrep | SAST | Teams, US$ 30 | por contribuidor | 156 | **até 10 devs e 10 repos** | [O] [19] |
| Snyk | SAST/SCA | Team, ~US$ 25 | por dev (mínimo de 5 [T]) | ~130 | 100 testes/mês | [O]/[T] [20][21] |
| CodeRabbit | Revisão de PR com IA | Essentials, US$ 24 (anual) / 30; Team, US$ 48 / 60 | por usuário que abre PR | 125 / 156; 250 / 312 | repos públicos | [O] [22] |
| Qodo | Revisão de PR com IA | Pro Team, US$ 30 | **unidade não clara** | 156 | não | [O] [23] |
| GitHub Copilot | IA (com code review) | Business, US$ 19 | por assento | 99 | Free, sem review | [O] [24][25] |
| Greptile | Revisão de PR com IA | Pro, US$ 30 | por assento | 156 | 1 dev | [O] [27] |
| Sourcery | Revisão de PR com IA | Team, US$ 24 (anual) | por dev | 125 | OSS | [O] [28] |
| Gremlin / Steadybit / Harness | Caos (infraestrutura) | não público | por serviço/time | — | trial de 30 d | [O] [29–31] |
| AWS FIS | Caos (infraestrutura) | US$ 0,10 | por ação-minuto | 0,52 | não | [O] [32] |
| LitmusChaos / Chaos Mesh | Caos (Kubernetes) | OSS | — | 0 | sim | [O] [33][34] |
| NDepend / Sonargraph | Arquitetura | não público ([T]: €399/ano; US$ 33–55) | por dev | ~196 [T] | trial | [T] [35][38] |
| dependency-cruiser | Dependências | OSS (MIT) | — | 0 | sim | [O] [39] |

- **Nenhum concorrente mostra preço em R$ nem aceita Pix ou boleto** nas páginas de preço (os checkouts não foram verificados). Isso soma IOF e spread para o comprador e complica a nota fiscal.
- **Referência local:** Square Cloud cobra de R$ 9,99 a R$ 299,90/mês, com Pix [40]. O Economista não achou SaaS brasileiro de qualidade, SAST ou caos com preço público.
- **Caos não tem âncora pública:** os de infraestrutura são sob cotação ou OSS.

## 5. Comparação normalizada para times de 3, 10 e 30 devs

Fonte: `eco.md`, seção 2 (R$/mês, a R$ 5,03 + IOF). As duas últimas linhas são a proposta do Economista (seção 6.2), não o preço atual.

| Produto/plano | 3 devs | 10 devs | 30 devs |
|---|---|---|---|
| **ShielDepy Starter** (mensal / anual) | **99 / 79** | não atende | não atende |
| **ShielDepy Completo** (mensal / anual) | **249 / 199** | **249 / 199** | **249 / 199** |
| SonarQube Cloud Free / Semgrep Free | 0 / 0 | 0 / 0 | 0 / 4.685 |
| SonarQube Cloud Team (≤100k LOC) | 177 | 177 | 177 (30 devs quase sempre passam de 100k LOC) |
| Codacy Team (anual) | 281 | 937 | 2.811 |
| Copilot Business | 297 | 989 | 2.967 |
| CodeScene Standard | 318 | 1.060 | 3.181 |
| CodeRabbit Essentials / DeepSource / Sourcery (anual) | 375 | 1.249 | 3.748 |
| Greptile Pro / Qodo* | 469 | 1.562 | 4.685 |
| Snyk Team [T] | 651 (mínimo de 5) | 1.302 | ~16.399 (Ignite [T]) |
| CodeRabbit Team (anual) | 750 | 2.499 | 7.497 |
| *Proposta: Time (até 15)* | *349–449* | *349–449* | não atende |
| *Proposta: Business (até 50)* | — | — | *990–1.490* |

\*Qodo, na premissa de cobrança por usuário.

**Leitura:**
- **3 devs:** o Completo custa o mesmo que **um** assento do CodeRabbit Team. O Starter custa o mesmo que um assento do Copilot Business.
- **10 e 30 devs:** o Completo fica 4 a 30 vezes mais barato que as ferramentas pagas por assento. O preço fixo e ilimitado deixa dinheiro na mesa.
- **Câmbio** (`eco.md`, seção 5): de R$ 5,00 a R$ 6,00, os concorrentes ficam ~20% mais caros e nenhuma conclusão muda. O ShielDepy cobra em R$ e não oscila.

## 6. Margem e ROI

### Margem por cliente (R$/mês)

Fonte: `eco.md`, seção 3. Margem = preço − Simples − Stripe (3,99% + R$ 0,39 + 0,7% do Billing) − IA − hospedagem [E].

| Plano | Preço | Simples 6% | Simples 15,5% |
|---|---|---|---|
| Starter mensal | 99 | R$ 85 (86%) | R$ 76 (76%) |
| Starter anual | 79 | R$ 67 (85%) | R$ 60 (76%) |
| Completo, IA leve (a: R$ 0,94) | 249 | R$ 212 (85%) | R$ 188 (76%) |
| Completo, IA típica (b: R$ 29,5) | 249 | R$ 185 (74%) | R$ 161 (65%) |
| Completo, sem `--base` (c: R$ 119) | 249 | R$ 95 (38%) | R$ 71 (29%) |
| Completo, pesado com `--base` (d: ~R$ 178 [E]) | 249 | R$ 36 (14%) | R$ 12 (5%) |
| Completo, pesado sem `--base` (e: ~R$ 2.853 [E]) | 249 | **−R$ 2.639** | **−R$ 2.663** |
| Completo anual, cenário d | 199 | **−R$ 9** | **−R$ 28** |

**Contradição entre os agentes.** Os cenários b a e supõem que **a ShielDepy paga a IA**. O Engenheiro achou o contrário: a IA é **BYOK**, a chave e o custo são do cliente (`AiService.ts:67-68`). Assim:
- **Hoje** o custo de IA da ShielDepy é zero, e a margem do Completo fica no nível do cenário a (~85% no Anexo III). O prejuízo dos cenários d e e **não acontece**.
- O risco só passa a existir se a ShielDepy decidir **incluir** a IA (a "cota justa" da seção 6.2 do Economista). Para isso faltam um proxy da API, medição de consumo e cota, que não existem no código.
- A hospedagem (R$ 3–8 por cliente com 100 clientes, R$ 15–40 com 20) é estimativa [E] de um portal que ainda não está no ar.

### ROI do comprador

Fonte: `eco.md`, seção 4. Horas de dev por mês que pagam o plano.

| Plano | R$/mês | a R$ 60/h | a R$ 90/h (central) | a R$ 155/h |
|---|---|---|---|---|
| Starter anual / mensal | 79 / 99 | 1,3 / 1,7 h | **0,9 / 1,1 h** | 0,5 / 0,6 h |
| Completo anual / mensal | 199 / 249 | 3,3 / 4,2 h | **2,2 / 2,8 h** | 1,3 / 1,6 h |
| *CodeRabbit Team, 10 devs* | 2.499 | 41,6 h | *27,8 h* | 16,1 h |

**Leitura:** o Completo se paga se evitar ~3 horas de dev por mês, menos que um incidente de produção [E]. O ROI não é a barreira. As barreiras são a confiança, o alcance (só Express) e o fato de que hoje não há como comprar.

## 7. Posicionamento e veredito por plano

### 7.1 Onde é único, onde empata, onde perde

A matriz é do Engenheiro (`eng.md`, seção 4). A coluna de concorrência usa as categorias do Economista e não testa os recursos dos concorrentes.

| Capacidade | ShielDepy | Referência na concorrência | Resultado |
|---|---|---|---|
| Caos gerado da topologia rota → I/O (nível de app) | parcial: só Express + pg/Prisma | Gremlin, Steadybit, Harness, FIS, Litmus: caos de **infraestrutura** | **Único**, mas estreito |
| Colisões de escrita entre handlers | sim (TS/JS, Spring, Django, MediatR, PL/pgSQL) | nenhuma categoria levantada | **Único** |
| Ciclos de chamada provados | sim (TS/JS), sem portão | dependency-cruiser (ciclos de módulo, grátis), NDepend, Sonargraph | **Empata** com o grátis no básico; ganha na prova de chamada |
| Modo offline / custo zero | sim | Sonar Free, Semgrep Free, OSS | **Empata** |
| IDE (VS Code) | sim, sem distribuição | a maioria tem | **Empata** (perde enquanto não publicar) |
| Sugestão de correção com IA | sim (BYOK) | Copilot, CodeRabbit, Qodo, Sourcery | **Empata**, e a verificação no grafo é um extra |
| Portão no CI | parcial, nunca rodou no Actions | todos os de PR e SAST | **Perde** hoje |
| Revisão de PR com IA | parcial: só o parágrafo do caos | CodeRabbit, Greptile, Copilot | **Perde** |
| Qualidade estática / lint | não | Sonar, Codacy, DeepSource | **Perde** (fora de escopo) |
| Multi-linguagem | parcial | Sonar, Semgrep, Snyk | **Perde** |
| Dashboard, SSO, billing | parcial / parcial / não | todos os pagos | **Perde** |
| Caos em infraestrutura | não | Gremlin, Litmus, FIS | fora de escopo |

### 7.2 Com quem compete de fato

- **Pelo produto,** o ShielDepy é uma categoria nova: caos no nível do handler, gerado do código, rodando no PR. Não há concorrente direto com preço público.
- **Pelo orçamento,** compete com "ferramentas de qualidade no PR" (o Economista, seção 2). É o mesmo dinheiro de SonarQube, Codacy, CodeRabbit e Copilot.
- **Preço-âncora que o comprador vai usar:**
  - time pequeno (≤10 devs): **R$ 0** (SonarQube Cloud Free, Semgrep Free) e, para pagar, **~R$ 99–125 por dev** (Copilot Business, CodeRabbit Essentials);
  - time de 10: CodeRabbit Essentials a **R$ 1.249/mês** e Copilot Business a **R$ 989/mês**.
- **Consequência:** o preço não precisa ser baixo, mas o valor precisa aparecer **no PR** (o portão no CI barrando) e **sem escrever contrato**. Hoje nenhum dos dois está provado fora do exemplo.

### 7.3 Veredito por plano

| Plano | Hoje | Proposta do Economista | O que o Engenheiro achou | **Veredito** |
|---|---|---|---|---|
| **Local (grátis)** | existe, mas não aparece na página | "Comunidade": 1 projeto, uso local, repos públicos | O motor roda sem conta em qualquer repo (`extension.ts:122`). Limitar a 1 projeto ou a repos públicos é **impossível** sem mudar a decisão do PLANO | **Criar na página como está:** tudo o que é determinístico, incluindo o caos offline e os exit codes da CLI. É a porta de entrada contra Sonar e Semgrep |
| **Starter** | R$ 99 / 79, ≤3 pessoas, sem CI | R$ 89–119, até 5 pessoas, **com portão no CI offline** | Não há limite. O grátis já entrega tudo o que ele vende | **Reestruturar.** Hoje não tem o que vender. Vira o plano de conta: portal, equipe, histórico do caos e template de CI (com o portão de colisões). Preço de **R$ 99** mantido, até 5 pessoas, **só quando houver limite no código** |
| **Completo** | R$ 249 / 199, ilimitado, IA | "Time", R$ 349–449, até 15 contribuidores, IA com cota | A IA é BYOK e o grátis com chave já tem. O portão e o painel são parciais | **Reestruturar em faixa** (até 15 contribuidores ativos em 90 dias) e **manter R$ 249 como preço de lançamento.** Escrever "IA com a sua chave". Subir para R$ 349–449 só depois de C2 + C4 + uma fatia da F e de validar com 5–10 times (a ressalva do próprio Economista) |
| **Business** (novo) | — | R$ 990–1.490, até 50, painel multi-repo, SLA | Painel parcial e sem canal de suporte | **Adiar.** Nada que o diferencie existe. Até lá, o time de 30 vai para o Enterprise |
| **Enterprise** | sob consulta | sob consulta, referência de R$ 2.500–4.000 [E] | Sem Docker, `--pg` sem teste real, sem contato | **Manter sob consulta.** Usar a referência só internamente. "Implantação no seu ambiente" vira **em breve**, e o `--pg` vira "leitura pontual (beta)" |
| Anual −20% | só visual | manter | sem cobrança | **Manter** quando houver cobrança |

**Modelo de cobrança:** concordo com o Economista em três pontos: faixa por contribuidores ativos, cobrança **em R$ com Pix, boleto e NF-e** (a vantagem explícita contra os estrangeiros) e IA BYOK. Não incluir IA paga pela ShielDepy antes da medição real (5e) e de existir cota no código.

### 7.4 Promessas a tirar ou marcar "em breve"

| Promessa (arquivo) | Ação |
|---|---|
| "Só funciona se o repo estiver num projeto seu" (`Security.tsx:23-26`) | **Tirar** ou reescrever: "a conta controla a IA e o portal; o motor roda local" |
| "Suspender trava a extensão em até 1 minuto" (`Security.tsx:29-30`) | **Reescrever:** "a suspensão desliga a IA em até 1 minuto" |
| "Portão no CI para barrar o merge" (`Pricing.tsx`, `Bento.tsx:68`, `Story.tsx:204`) | **Em breve** até a C4 rodar e o template ganhar o `report --fail-on` |
| "Painel com o uso de cada repositório" | **Em breve** até o portal ser publicado |
| "CLI para rodar localmente" e o `shieldepy report …` (`Story.tsx:23`) | **Em breve** até existir pacote npm |
| "IA: explicações, chat e correção verificada" | Reescrever: "**com a sua chave** (Anthropic/…)"; e não usar como diferencial pago |
| "1 projeto, até 3 pessoas" | Tirar até haver limite no código |
| "Seis linguagens" (`Proof.tsx:118`) | Reescrever: "TS/JS completo; colisões em Java, Python e C#" |
| "Implantação no seu ambiente" | **Em breve** |
| "Assinar Starter/Completo" | Trocar por "Entrar na lista de espera" ou "Falar com o time", com um contato real |
| **Faltando:** o caos | **Incluir** com o alcance explícito: Express + pg/Prisma + fetch/axios |

## 8. O que precisa mudar antes de cobrar + tarefas propostas

### 8.1 Pré-requisitos para o primeiro real

| Item | Hoje | Mínimo para cobrar |
|---|---|---|
| Cobrança | nada (grep vazio) | Asaas (Pix/boleto a R$ 1,99, cartão a 2,99% + R$ 0,49) ou Stripe; NF-e; anual |
| Modelo de plano e limites | `companies` sem plano | coluna de plano, contagem de contribuidores ativos, bloqueio, aviso |
| Cadastro | só o admin cria empresa (`routes.ts:454`) | cadastro self-service + trial |
| Portal publicado | roda só com `npm run web` | hospedagem, domínio, TLS, OAuth configurado, backup |
| Distribuição | `.vsix` local, CLI `private` | `.vsix` nas Releases (C5), depois Marketplace; CLI no npm |
| Licença e repo | não decididos | decidir (a C5 já pergunta); o template de CI depende do repo público |
| Contato | rodapé vazio | e-mail ou formulário |
| Diferença entre grátis e pago | não existe | o pago traz portal, equipe, histórico, CI com comentário no PR |
| Termos de uso e privacidade (LGPD) | não verificado por nenhum agente | conferir antes de cobrar |

### 8.2 Proposta para o roadmap C (só proposta; o plano não foi alterado)

Ordem atual: **C1 → C2 → C5 → C3 → C4**. Proposta: **C1 → C4 → C2 (+C2f) → C6 → C5 (+C5b) → M → C3**.

| # | Tarefa | Onde | Por quê | Tamanho [E] |
|---|---|---|---|---|
| 1 | **Puxar a C4** para logo depois da C1 | C4 | O portão no CI é o que se vende e o que o Economista diz que "transforma o achado em hábito". Nunca rodou. O próprio PLANO diz que pode entrar depois da C1 | meio dia (o PLANO) |
| 2 | **C4b.** O template ganha o `report --fail-on critico` e o `cycles` ganha exit ≠ 0 com uma flag | C4 | A landing vende "colisão crítica: merge bloqueado", e o template não faz isso | pequeno |
| 3 | **C2f.** Aviso de "framework não suportado" quando a topologia dá 0 rotas e há Fastify, Nest, Koa ou `node:http` nas dependências | C2 | Evita o **falso verde silencioso** (risco 4 do Engenheiro). Tem que sair antes do release | pequeno |
| 4 | **C6. Honestidade da landing:** a tabela 7.4, a seção de caos com o alcance, o plano Local e os botões de lista de espera | nova, antes da C5 | O release vai mandar gente para a landing | ~1 dia |
| 5 | **C5b.** Publicar a CLI no npm (tirar o `private`, com `bin`) | C5 | "CLI local" e o portão no CI de terceiros dependem disso | pequeno |
| 6 | **Etapa M — monetização** (depois da C5): M1 plano e limites no banco; M2 cadastro e trial; M3 cobrança em R$ (Asaas); M4 portal publicado; M5 contato; M6 o que o pago destrava | nova | Sem ela, não há como cobrar (seção 8.1) | não estimado |
| 7 | **Validação de preço com 5–10 times** (design partners, de graça ou a R$ 249) | junto da C5 | É a ressalva do Economista antes de subir o preço; mede a disposição a pagar | contínuo |
| 8 | **5e.** A medição paga da IA, antes de qualquer IA inclusa | já existe | Os cenários b–e são estimativa | < US$ 0,50 (relatório de custo, seção 9) |
| 9 | Ordem da F: decidir pelas stacks dos design partners | C3 | O PLANO começa pelo `node:http` (prova no próprio portal). Para vender, Fastify e NestJS podem valer mais. **Não há dado de mercado nos relatórios**, então a sugestão é decidir com os times do item 7 | — |

## 9. Riscos e premissas

### Não verificado por nenhum agente

| Item | Situação | Impacto |
|---|---|---|
| E2E da extensão (`test:e2e`) | não rodado. O PLANO diz 33/33 no fim da etapa R | A "extensão entrega" se apoia nisso |
| Portal (`npm run web`) | não rodado | "Painel" e login não foram conferidos ao vivo |
| `report --pg` num Postgres real | não rodado (proibido conectar); `connect.ts` não tem teste | A promessa do Enterprise está sem prova |
| Workflow no GitHub Actions | nunca rodou (C4) | O "Portão no CI" está sem prova |
| Medição paga da IA (5e) | não feita | Os cenários de margem b–e são estimativa; a qualidade da IA também |
| Caos em projeto de terceiros | a C1 está pela metade: rotas acham nos 3 projetos, mas o `--init` e o `chaos` ainda não rodaram neles | O "funciona no seu projeto" não está provado |
| Checkout dos concorrentes (Pix, R$) | não verificado | O argumento "cobramos em R$" se apoia só nas páginas de preço |

### Riscos de negócio
1. **Canibalização:** com o grátis completo e a IA BYOK, o pago precisa de valor de conta (portal, equipe, CI). Hoje esse valor não está publicado.
2. **Mercado estreito:** só Express + pg/Prisma. Em Fastify, o caos diz "nada a testar" (verificado pelo Engenheiro).
3. **Promessas enganosas na segurança** (seção 7.4) para quem compra pelo controle de acesso.
4. **Preço "ilimitado" fixo:** inofensivo com BYOK. Vira prejuízo (−R$ 2.639/mês no cenário e) se a IA for incluída sem faixa nem cota.
5. **Licença e repo privado:** o template de CI e o download do `.vsix` dependem de uma decisão que ainda não foi tomada.

### Premissas do Economista
- Os preços [T] (Snyk Team e Ignite, NDepend, Sonargraph, Lattix) não foram confirmados em página oficial. A unidade do Qodo e a inclusão do review no Copilot Business não ficaram claras.
- O câmbio de cartão é ~5% maior que o das tabelas, o que favorece o ShielDepy.
- O enquadramento no Simples (Anexo III ou V, Fator R, CNAE) precisa do contador. A reforma tributária (CBS/IBS) não foi modelada.
- A hospedagem (US$ 50–150/mês) e o custo de um incidente são estimativas [E].
- O custo de dev (R$ 90/h central) vem de pesquisas salariais de 2026 [11–14].

## Fontes

Todas acessadas em 2026-10-16 (Economista, `eco.md`, seção 7). [T] = terceiro.

1. InfoMoney, dólar em 13–14/10/2026: https://www.infomoney.com.br/mercados/dolar-hoje-abertura-fechamento-comercial-turismo-14102026/
2. Wise USD→BRL: https://wise.com/gb/currency-converter/usd-to-brl-rate
3. Wise EUR→BRL: https://wise.com/gb/currency-converter/eur-to-brl-rate
4. ARQ Finance, IOF 2026: https://arqfinance.com/articles/?p=2031
5. Nomad, IOF: https://www.nomadglobal.com/conteudos/o-que-e-iof
6. Asaas, câmbio de cartão: https://www.asaas.com/cotacao-do-dolar
7. Agilize, Anexo III ou V: https://agilize.com.br/artigos/?p=4180 ; tabelas de 2026: https://artigos.agilize.com.br/tabela-anexos-simples-nacional-2026/
8. Barbieri Advogados, Fator R: https://www.barbieriadvogados.com/?p=1666
9. Stripe Brasil: https://stripe.com/br/pricing
10. Asaas, taxas: https://www.asaas.com/precos-e-taxas
11. JobRise: https://jobrise.io/pt/blog/quanto-ganha-um-desenvolvedor-no-brasil-2026/ e https://jobrise.io/pt/blog/salario-desenvolvedor-pleno-vs-senior-2026/
12. Numerando: https://www.numerando.com.br/blog/salario-desenvolvedor-software-brasil-2026
13. ValorFinal: https://valorfinal.com.br/guia/custo-funcionario
14. Contabilidade Zen: https://www.contabilidadezen.com.br/blog/quanto-custa-funcionario-encargos-2026/
15. SonarSource: https://www.sonarsource.com/plans-and-pricing/
16. Codacy: https://www.codacy.com/pricing
17. DeepSource: https://deepsource.com/pricing
18. CodeScene: https://codescene.com/pricing
19. Semgrep: https://semgrep.dev/pricing
20. Snyk: https://snyk.io/plans/
21. [T] Snyk: https://cipherssecurity.com/snyk-pricing-explained-2026/ e https://aicodereview.cc/blog/snyk-pricing
22. CodeRabbit: https://www.coderabbit.ai/pricing
23. Qodo: https://www.qodo.ai/pricing/
24. GitHub Copilot: https://github.com/features/copilot/plans
25. GitHub Docs, planos do Copilot: https://docs.github.com/en/copilot/get-started/plans
26. [T] Code review e créditos: https://github.blog/2026-05-01-github-copilot-is-moving-to-usage-based-billing/ e https://samexpert.com/github-copilot-licensing-guide/
27. Greptile: https://www.greptile.com/pricing
28. Sourcery: https://www.sourcery.ai/pricing
29. Gremlin: https://www.gremlin.com/pricing
30. Steadybit: https://steadybit.com/pricing/
31. Harness: https://www.harness.io/pricing
32. AWS FIS: https://aws.amazon.com/fis/pricing/
33. LitmusChaos: https://github.com/litmuschaos/litmus
34. Chaos Mesh: https://github.com/chaos-mesh/chaos-mesh
35. [T] Sonargraph: https://alternativeto.net/software/sonargraph/about
36. [T] Lattix: https://esj.com/articles/2006/01/16/lattix-ldm-for-eclipse-now-available.aspx ; https://www.lattix.com/
37. NDepend: https://www.ndepend.com/purchase
38. [T] Capterra, NDepend: https://www.capterra.com/p/235123/NDepend/
39. dependency-cruiser: https://github.com/sverweij/dependency-cruiser
40. Square Cloud: https://squarecloud.app/pt-br/pricing
41. Conviso: https://www.convisoappsec.com/partners
42. Custo de IA: `RELATORIO-CUSTO-IA.md` (seções 1, 5, 7 e 9)

As fontes 33, 34 e 39 (repositórios OSS) foram citadas pela licença conhecida, sem acesso nesta sessão.

---

*Entradas: `eng.md` e `eco.md` (scratchpad da sessão), `Pricing.tsx` e `PLANO-CHAOS.md` (seções "Como retomar", "C" e o Registro da C1). Nada no repositório foi alterado.*

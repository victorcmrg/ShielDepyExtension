# Relatório de custo da IA no ShielDepy (pipeline de caos)

**Data:** 2026-10-08 (atualizado com os lotes do Threat Modeler) · **Base:** branch `feat/mapa-incremental` (E5) · **Preços:** Claude API, primeira parte, conferidos em 2026-10-08 · **Câmbio assumido:** R$ 5,50 por dólar

## 1. Resumo

- **Uma execução completa custa cerca de um centavo de dólar** no exemplo `checkout-express` (2 rotas), com todos os nós no Haiku 4.5: **~US$ 0,012 (~R$ 0,07)**. Com o Threat Modeler no Sonnet 5.5, fica em **~US$ 0,026 (~R$ 0,14)**.
- **Na maioria dos PRs o custo é zero.** Com `--base`, só as rotas sensíveis que o PR tocou vão para a IA. Um PR que não toca nenhuma não faz chamada alguma.
- **O custo não decide a escolha do modelo.** Mesmo para 100 rotas sensíveis, uma execução completa fica entre US$ 0,49 (só Haiku) e US$ 0,87 (Threat Modeler no Sonnet). A decisão deve vir da qualidade das hipóteses, que só a medição paga mostra.
- **Achado já corrigido:** o limite de 4000 tokens de saída do Threat Modeler estourava a partir de ~7 rotas que gravam dados. Agora a superfície vai em **lotes de 5 rotas** (seção 6), e os valores deste relatório já incluem o custo dos lotes.
- **Estes números são uma estimativa** (seção 2). O comando da seção 9 mede o custo real, em menos de US$ 0,50 no total.

## 2. Como foi estimado

Não havia chave da API no ambiente, e a medição paga depende de autorização. Por isso a estimativa usa o pipeline de verdade, sem chamar a API:

1. O script `npm run estimate:chaos` (`shieldepy_p1/scripts/estimate-chaos-cost.ts`) roda o pipeline real nos dois exemplos: topologia → superfície → Threat Modeler → especialistas → parágrafo do relatório.
2. Um provider falso **grava cada requisição**: o prompt de sistema e a mensagem reais, o tier e o `max_tokens`. Ele devolve respostas válidas, do tamanho de respostas reais, para o fluxo seguir igual (hipóteses com uma justificativa de 1–2 frases, specs com invariantes e um parágrafo de ~100 palavras).
3. Os tokens saem dos caracteres, a **3,5 caracteres por token** (português com JSON), numa faixa de 2,8 a 4,2. O número exato só a API dá.
4. **Raciocínio:** o Sonnet 5.5 e o Opus 5.5 raciocinam por padrão, e o raciocínio é cobrado como saída. A estimativa soma 0 / 1.000 / 3.000 tokens por chamada (faixa baixa, central e alta). O Haiku 4.5 não raciocina neste uso.

**Limites:** o tamanho das respostas é plausível, não medido; o raciocínio é a maior incerteza; e os exemplos são pequenos (2 rotas).

## 3. O que cada execução chama

Valores centrais e faixa, em tokens.

| Exemplo | Nó | Tier | `max_tokens` | Entrada | Saída (sem raciocínio) |
|---|---|---|---|---|---|
| `checkout-express` | Threat Modeler | deep | 4000 | 1.423 (1.186–1.779) | 513 (427–641) |
| `checkout-express` | Especialista (×4) | fast | 800 | 1.043–1.171 cada | 72–85 cada |
| `checkout-express` | Parágrafo do relatório | fast | 800 | 1.395 (1.162–1.743) | 155 (129–193) |
| `checkout-express-fixed` | Threat Modeler | deep | 4000 | 1.360 (1.134–1.700) | 513 (427–641) |
| `checkout-express-fixed` | Especialista (×3) | fast | 800 | 987–1.115 cada | 72–85 cada |

- **Vulnerável:** 6 chamadas, ~7.300 tokens de entrada e ~1.000 de saída. O parágrafo do relatório só existe quando há achado.
- **Corrigido:** 4 chamadas, ~4.600 de entrada e ~750 de saída. Ele não tem hipótese de timeout nem achado.
- **A entrada pesa mais que a saída.** Cada chamada leva o prompt de sistema (~270 a ~600 tokens) mais a rota em JSON. Nenhum código-fonte vai para a IA, só a superfície de ataque.

## 4. Custo por execução, por configuração de modelos

Preços por milhão de tokens (entrada / saída): Haiku 4.5 US$ 1 / 5 · Sonnet 5.5 US$ 2 / 10 · Opus 5.5 US$ 4 / 20.

| Configuração | `checkout-express` (US$) | `checkout-express-fixed` (US$) | Vulnerável em R$ (central) |
|---|---|---|---|
| **A.** Tudo no Haiku 4.5 (padrão atual) | **0,012** (0,010–0,015) | 0,008 (0,007–0,010) | ~R$ 0,07 |
| **B.** Threat Modeler no Sonnet 5.5, resto no Haiku | **0,026** (0,014–0,050) | 0,022 (0,010–0,045) | ~R$ 0,14 |
| **C.** Threat Modeler no Opus 5.5, resto no Haiku | 0,044 (0,020–0,090) | 0,040 (0,017–0,085) | ~R$ 0,24 |
| **D.** Tudo no Sonnet 5.5 | 0,085 (0,020–0,211) | 0,057 (0,014–0,141) | ~R$ 0,46 |

**Leitura:**
- A diferença entre A e B é de ~US$ 0,014 por execução, e quase toda vem do **raciocínio** do Sonnet, não do preço por token.
- A configuração D é a mais cara e a mais incerta: o raciocínio entra em todas as 6 chamadas, e os especialistas só preenchem parâmetros validados, sem ganho visível de qualidade.
- **Comparação com a estimativa antiga do plano** (~8k de entrada / ~6k de saída, ~R$ 0,21 no Haiku): a entrada bateu (~7,3k), mas a saída real é ~6× menor (~1k), porque as respostas são JSON curto e validado.

## 5. Escala: sistemas maiores

Hipótese da projeção: metade das rotas sensíveis grava dados com uma API externa no meio, como o `POST /checkout` (4 especialistas cada); a outra metade só lê, como o `GET /orders/:id` (nenhum teste). Valores centrais, com 1.000 tokens de raciocínio por chamada nos modelos que raciocinam.

| Rotas sensíveis | Entrada do Threat Modeler | Saída do Threat Modeler | Chamadas de especialista | A (US$) | B (US$) | C (US$) | D (US$) |
|---|---|---|---|---|---|---|---|
| 2 | 1.423 | 513 | 4 | 0,012 | 0,026 | 0,044 | 0,084 |
| 20 (4 lotes) | 10.660 | 5.130 | 40 | 0,099 | 0,176 | 0,288 | 0,649 |
| 100 (20 lotes) | 53.300 | 25.650 | 200 | 0,487 | 0,870 | 1,432 | 3,186 |

Com lotes, a entrada do Threat Modeler soma o prompt de sistema repetido em cada lote (~595 tokens), e, no Sonnet e no Opus, cada lote tem o seu raciocínio. É isso que separa as configurações B, C e D da A em sistemas grandes.

## 6. Achado: o limite de saída do Threat Modeler (corrigido)

- **O problema:** o Threat Modeler era chamado **uma vez, com a superfície inteira**, e `max_tokens: 4000`. A resposta cresce ~513 tokens por rota que grava dados, e o limite estourava a partir de **~7 rotas** desse tipo (~5 com o raciocínio do Sonnet, que também gasta o `max_tokens`). Os testes não se perdiam, porque a lista-base do motor seguia, mas a contribuição da IA sumia e a chamada era cobrada assim mesmo.
- **A correção (tarefa 5g do plano):**
  - a superfície vai em **lotes de 5 rotas**, cada lote com as colisões que tocam as suas rotas;
  - os lotes rodam em paralelo, no máximo 4 ao mesmo tempo (por causa do limite de requisições da API);
  - o `max_tokens` é proporcional ao lote: 2.000 + 1.000 por rota (7.000 num lote de 5), com folga para o raciocínio;
  - um lote que falha não derruba os outros: as rotas dele ficam com a lista-base, e o erro diz qual lote foi.
- **Custo dos lotes:** o prompt de sistema se repete em cada lote (~595 tokens) e, no Sonnet ou no Opus, o raciocínio também. Para 100 rotas, são ~US$ 0,01 a mais no Haiku e ~US$ 0,21 a mais no Sonnet. Os valores das seções 1, 5 e 7 já incluem isso.
- **Cache:** com o prompt de sistema repetido, o cache poderia valer no Sonnet (mínimo de 512 tokens). Mas os lotes saem em paralelo, e uma chamada só lê o cache depois que outra o gravou. O ganho seria de ~US$ 0,001 por lote, e não compensa atrasar o primeiro.

## 7. Custo por mês (cenários)

| Cenário | Premissas | A (só Haiku) | B (Threat Modeler no Sonnet) |
|---|---|---|---|
| PRs com `--base` | 100 PRs/mês, sistema de 20 rotas sensíveis; 15% dos PRs tocam ~2 delas | ~US$ 0,18 | ~US$ 0,39 |
| PRs sem `--base` | 100 PRs/mês, sistema de 20 rotas sensíveis | ~US$ 9,90 | ~US$ 17,60 |
| Rodada noturna completa | 30 noites, 20 rotas sensíveis | ~US$ 2,97 | ~US$ 5,28 |
| Rodada noturna pela Batch API | igual, com 50% de desconto | ~US$ 1,49 | ~US$ 2,64 |

O `--base` (E5) é a maior alavanca: ele reduz o custo dos PRs em ~50×. O modo `--offline` continua custando zero, e é o padrão do CI quando não há chave.

## 8. Alavancas de custo: o que vale e o que não vale

| Alavanca | Efeito aqui | Situação |
|---|---|---|
| `--base` (só o que o PR tocou) | Corta a maioria das execuções para zero | ✅ Feito (E5) |
| Modo `--offline` | Custo zero, com a lista-base do motor | ✅ Feito (E3) |
| Especialistas no tier `fast` (Haiku) | Evita raciocínio onde a IA só preenche parâmetros | ✅ Feito (E3) |
| Nenhum código e nenhum log para a IA | A entrada fica em ~1–1,5k tokens por chamada | ✅ Feito (E2–E4) |
| Cache de prompt | **Não ativa hoje.** Os prompts de sistema (~270–600 tokens) ficam abaixo do mínimo do Haiku (4.096). No Sonnet, só o do Threat Modeler passa do mínimo (512), e o ganho seria de ~US$ 0,001 por chamada | Documentado; vale depois dos lotes |
| Batch API (50%) | Só para rodadas noturnas: o PR não pode esperar até 24 h | Para depois |
| Lotes no Threat Modeler | Necessário para sistemas com mais de ~5–7 rotas de escrita | ✅ Feito (5g) |
| Encher o prompt para cachear (ex.: normas ISO) | Aumentaria o custo | Não fazer |

## 9. Próximo passo: a medição real

Para trocar a estimativa por números exatos (tokens reais, raciocínio real e a qualidade das hipóteses), rode:

```bash
cd shieldepy_p1
ANTHROPIC_API_KEY=... npm run measure:chaos -- --sim-gastar
```

O script roda os dois exemplos com o Threat Modeler no Haiku 4.5 e no Sonnet 5.5. Gasto previsto: **menos de US$ 0,50 no total.** Ele confirma ou corrige três coisas:
1. o raciocínio real do Sonnet 5.5 (a maior incerteza desta estimativa);
2. se o Threat Modeler no Sonnet cabe nos 4000 tokens já no exemplo pequeno;
3. a diferença de qualidade: hipóteses extras, justificativas e prioridades.

## 10. Recomendação

1. **Manter o padrão atual (tudo no Haiku 4.5)** até a medição real. É o mais barato e não corre risco de corte.
2. **O limite do Threat Modeler já foi corrigido (lotes).** Num repositório grande, confira na medição real se o raciocínio do Sonnet cabe nos 7.000 tokens de um lote de 5 rotas.
3. **Decidir o Threat Modeler no Sonnet 5.5 pela qualidade, não pelo custo.** A diferença é de ~US$ 0,014 por execução, ou ~US$ 0,20 por mês com `--base`.
4. **Não usar o Sonnet nos especialistas** (configuração D): custa 3 a 4 vezes a configuração B (e ~7 vezes a A), sem ganho esperado.

---

*Reprodução: `npm run estimate:chaos` (grátis) gera `shieldepy_p1/.shieldepy/estimate-chaos-cost.json` com cada chamada. Detalhes da implementação e do histórico em `PLANO-CHAOS.md`.*

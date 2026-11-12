# 0041 — Sons baixinhos na encenação do "Entrar", do Epidemic Sound, com Web Audio

**Data:** 2026-11-12 (pedido do usuário: "use minha conta no Epidemic Sound para baixar SFX para essa animação; os sons devem ser baixos, só para complementar") · **Estado:** valendo

**Contexto.** A encenação do `/entrar` ([0039](0039-entrar-encenado.md)) era muda. O usuário pediu efeitos leves: vento de câmera longo, grave e lento na entrada e na saída; balão batendo quando as letras e o 404 caem no chão; clique suave de interface; um "hum" agudo de mascote para os cursores; madeira leve arrastando, contínua, enquanto a caixa principal é arrastada; uma tecla para cada letra digitada.

**Decisão.**
- **Os sons vêm do Epidemic Sound, pela conta do usuário** (que confirmou cada download no navegador). São 10 efeitos cortados e reamostrados com ffmpeg (mono, MP3 96 kbps, 224 KB ao todo) em `apps/web/public/sfx/`: `whoosh-in` e `whoosh-out` (vento de 5 a 6 s, mais lento e grave com `asetrate` 0,85), `thud-1`, `thud-2` e `thud-big` (balão batendo), `click`, `hum-1` e `hum-2`, `wood-drag` (laço) e `key`. O "Hit, Short, Deep" que eu tinha escolhido não estava disponível na conta; foi trocado por um balão grande batendo.
- **Web Audio** (`entrar/sfx.ts`): cada som é carregado uma vez e tocado com ganho e velocidade próprios (com um pouco de variação para não soar repetido); o volume geral é 0,32, baixo de propósito. A madeira é um laço cujo volume segue a velocidade do cursor que arrasta (a caixa, o logo encolhendo, as peças levadas, o CPF).
- **Onde toca:** vento no zoom e na entrada do primeiro cursor, e na volta da câmera e no fim; balão no primeiro toque de cada peça no chão (os números mais graves); clique em cada clique dos cursores, no cartão aparecendo e no carregamento; um "zip" curto no rastro do teletransporte; "hum" no nascimento, no sumiço e nos esbarrões dos cursores e no encontro final; tecla em cada toque de digitação; um "ploc" quando a ponte líquida rompe.
- **Autoplay:** se o navegador bloquear o áudio até um clique, aparece no canto o botão "ativar som", que não pula a animação. Sem Web Audio, ou se um arquivo não carregar, a cena segue muda, sem erro. O gancho de desenvolvimento `__entrarSeek` não toca nada.

**Consequências.**
- **Licença:** a licença do Epidemic Sound é da conta do usuário, que autorizou pôr os arquivos no repositório e servi-los no site (2026-11-13). Sem eles, a encenação roda muda.
- Trocar um som é só trocar o arquivo com o mesmo nome em `public/sfx/`.

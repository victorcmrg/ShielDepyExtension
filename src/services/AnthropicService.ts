import * as vscode from 'vscode';
import Anthropic from '@anthropic-ai/sdk';
import type { EnclosingSymbol, GraphSnapshot, SymbolContextEntry } from '../graph/GraphManager';

// FRONTEIRA ARQUITETURAL: este é o ÚNICO arquivo que fala com a API da Anthropic. Os quatro
// métodos abaixo só devem devolver CONTEÚDO ANALÍTICO (texto de revisão, trecho de código,
// achados em JSON, resposta de chat) — nunca HTML/CSS/SVG, cor, timing de animação, ou qualquer
// instrução de exibição. Todo o sistema visual (badges, overlay de leitura, marca-texto,
// animação de "pensando") é gerado por código determinístico nosso (GraphManager,
// BackgroundAnalyzer, ScanAnimator, AnalyzingDecorationProvider, e o HTML estático dos
// webviews) — dispara em resposta ao ciclo de vida real da análise, não é pedido à IA em
// nenhum momento. Isso é intencional: manter a UI 100% fora do custo de tokens e determinística.

const LANGUAGE_NAMES: Record<string, string> = {
  'pt-BR': 'português do Brasil',
  'en-US': 'English (US)',
  es: 'español',
  ru: 'русский (russo)',
};

/** Idioma configurado nas Configurações do ShielDepy — usado pra escrever achados e respostas do chat. */
function getConfiguredLanguageName(): string {
  const code = vscode.workspace.getConfiguration('shieldepy').get<string>('language', 'pt-BR');
  return LANGUAGE_NAMES[code] ?? LANGUAGE_NAMES['pt-BR'];
}

const ARCHITECT_SYSTEM_PROMPT = `Você é um Agente Copilot Staff Engineer ultrarrápido operando dentro do VS Code.

OBJETIVO: Seu objetivo NÃO é ler arquivos de texto linearmente. Analise a estrutura do código através de GRAFOS (dependências e AST fornecidos no contexto) para avaliar a melhor forma de otimizar e melhorar o sistema com segurança absoluta para produção.

DIRETRIZES:
1. ANÁLISE VIA GRAFOS: Avalie o impacto da mudança no subgrafo (vizinhança). Se um estado muda, verifique se isso cria ciclos infinitos nos nós conectados (efeitos colaterais em cascata).
2. PREVENÇÃO DE BUGS: Identifique proativamente condições de corrida (race conditions), tratamentos de erros assíncronos falhos e memory leaks.
3. VELOCIDADE E FOCO: Seja direto. Não explique sintaxe básica. Fale de concorrência, arquitetura e tempo de execução.

OBRIGAÇÃO DE TESTES (5 CASOS): Ao corrigir ou otimizar, forneça obrigatoriamente 5 casos de teste (Jest/Vitest/Mocha) focados em provar a mitigação da falha:
- Teste 1: Caminho feliz (comportamento base).
- Teste 2: Concorrência/Carga (múltiplas requisições simultâneas).
- Teste 3: Falha assíncrona/Timeout (tratamento de erro).
- Teste 4: Efeito colateral/Loop infinito (garantir isolamento de estado).
- Teste 5: Edge case extremo (nulos, limites de memória, inputs inválidos).

FORMATO DE SAÍDA:
- [🔴 Risco/Otimização]: O problema no subgrafo.
- [🟢 Solução Segura]: Código otimizado.
- [🔗 Impacto no Grafo]: Componentes adjacentes afetados.
- [🧪 5 Testes de Produção]: Código dos testes exigidos.`;

const INLINE_SYSTEM_PROMPT = `Você é um motor de autocomplete de código ultrarrápido, estilo Copilot, rodando dentro do VS Code.
Você recebe o código antes e depois do cursor, qual função/método envolve o cursor agora, e a vizinhança REAL dessa função no grafo (quem ela chama, quem a chama, com assinatura quando disponível).
Responda APENAS com o trecho de código que deve ser inserido exatamente na posição do cursor — nunca repita o prefixo, nunca use markdown, nunca explique.
Priorize, nesta ordem: (1) se for sugerir uma chamada a outro símbolo, use SOMENTE nomes que apareçam na lista de conectados, respeitando a assinatura informada — nunca invente parâmetro ou nome que não esteja lá; (2) consistência com os símbolos já usados na vizinhança; (3) evitar padrões que criem ciclos de chamadas ou side-effects não isolados; (4) completar de forma curta e imediatamente útil. Se não houver uma continuação óbvia e segura, responda com uma string vazia.`;

const SCAN_SYSTEM_PROMPT = `Você é um verificador arquitetural ultrarrápido rodando em background no VS Code, disparado a cada pausa de digitação (idle) ou colagem de código — não em cada tecla.
Analise a estrutura via GRAFOS: o subgrafo de impacto informado é a vizinhança real do arquivo (quem ele importa, quem o importa, quem chama quem). Não reexplique o código nem aponte estilo.
Sinalize SOMENTE riscos concretos de produção: condições de corrida, promises/async sem tratamento de erro ou rejeição, listeners/timers/subscriptions sem cleanup (memory leak), ciclos de chamada entre os nós do subgrafo (efeito cascata / loop infinito entre componentes), e mutação de estado compartilhado sem isolamento.
Se não houver risco concreto, responda com um array vazio.
Para cada risco, se ele puder quebrar ou afetar outro ponto do subgrafo (outra função, outro arquivo que importa ou chama este código), preencha "impact" citando esse ponto pelo nome (ex: "Isso pode quebrar handleLogin() em auth.ts, que depende do retorno síncrono desta função"). Se não houver impacto identificável em outra área, use uma string vazia.
Responda APENAS com um array JSON, sem markdown, sem texto fora do JSON, exatamente neste formato:
[{"startLine": number, "endLine": number, "severity": "error"|"warning"|"info", "message": string, "impact": string}]
Os números de linha são 0-indexados e relativos ao arquivo completo enviado (a numeração vem prefixada em cada linha do código, não a inclua na resposta).`;

// JSON em vez de prosa: mais compacto (menos tokens no system prompt, chamado a cada
// mensagem do chat) e sem ambiguidade de leitura — cada regra é um campo, não uma frase solta.
// Função (não const) porque o idioma vem de uma setting que pode mudar a qualquer momento.
function buildChatSystemPrompt(): string {
  return JSON.stringify({
    role: 'ShielDepy — staff engineer de arquitetura, em chat dentro do VS Code',
    contexto_recebido: ['arquivo ativo numerado por linha', 'subgrafo de dependências', 'achados já detectados, cada um com #id'],
    estilo: {
      idioma: getConfiguredLanguageName(),
      tom: 'direto, sem saudação, sem repetir a pergunta antes de responder',
      formatacao: 'texto corrido apenas — sem markdown (sem #, **, _, listas com -, sem blocos de código soltos), frases curtas, sem parágrafo de fechamento',
      foco: ['concorrência', 'arquitetura', 'risco real de produção'],
      evitar: 'explicar sintaxe básica ou o que o código faz linha a linha',
    },
    citar_achados: 'referencie pelo #id quando relevante',
    correcao: {
      quando: 'usuário pede correção e você tem certeza dela',
      escopo: 'resolva TODOS os achados listados pro arquivo nesta mesma resposta, não só o que foi perguntado — corrigir um por vez e deixar os outros gera retrabalho e desperdiça chamadas',
      antes_de_responder: 'releia o arquivo corrigido internamente contra as mesmas categorias que os achados verificam (ciclo de chamadas entre funções/arquivos, race condition, promise/async sem tratamento de erro, listener/timer sem cleanup, mutação de estado compartilhado) — se a sua própria correção introduzir um problema novo dessas categorias, ajuste até não introduzir nenhum, sem mencionar esse processo na resposta',
      formato: 'explicação curta em texto corrido, depois: FIXED_FILE: <caminho>\n```\n<arquivo INTEIRO corrigido>\n```',
      regra: 'só reescreva um arquivo já mostrado nesta conversa; nunca invente conteúdo; se não tiver certeza de resolver tudo sem regressão, pergunte em vez de propor FIXED_FILE — alucinar uma correção errada é pior que perguntar',
    },
  });
}

export type ModelTier = 'fast' | 'deep';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatContext {
  history: ChatTurn[];
  activeFile?: { path: string; text: string };
  subgraph?: GraphSnapshot;
  findings?: Array<{ id: string; line: number; severity: string; message: string; impact?: string }>;
}

export interface RiskFinding {
  startLine: number;
  endLine: number;
  severity: 'error' | 'warning' | 'info';
  message: string;
  impact?: string;
}

export const API_KEY_SECRET_KEY = 'shieldepy.anthropicApiKey';

export class AnthropicService {
  private client: Anthropic | undefined;

  constructor(private readonly output: vscode.OutputChannel, private readonly secrets: vscode.SecretStorage) {}

  /** Revisão arquitetural completa — usada pelo comando manual, tolera mais latência. */
  async reviewChange(fileText: string, filePath: string, subgraph: GraphSnapshot): Promise<string> {
    const client = await this.getClient();

    const response = await client.messages.create({
      model: this.modelFor('deep'),
      max_tokens: 3000,
      system: `${ARCHITECT_SYSTEM_PROMPT}\n\nResponda sempre em ${getConfiguredLanguageName()}.`,
      messages: [
        {
          role: 'user',
          content: [
            `ARQUIVO ALTERADO: ${filePath}`,
            '```typescript',
            fileText,
            '```',
            '',
            'SUBGRAFO DE IMPACTO (nós e arestas adjacentes no grafo de arquitetura):',
            '```json',
            JSON.stringify(subgraph, null, 2),
            '```',
          ].join('\n'),
        },
      ],
    });

    return this.extractText(response);
  }

  /**
   * Sugestão inline (ghost text) — baixa latência, poucos tokens, sem exigência de testes.
   * `enclosing`/`localContext` vêm da vizinhança REAL do símbolo que envolve o cursor (não do
   * arquivo inteiro) — é o que garante que uma chamada sugerida a outra função/arquivo bata
   * com o nome e a assinatura de verdade, na mesma chamada, sem round-trip extra.
   */
  async getInlineSuggestion(params: {
    prefix: string;
    suffix: string;
    languageId: string;
    subgraph: GraphSnapshot;
    enclosing?: EnclosingSymbol;
    localContext?: SymbolContextEntry[];
  }): Promise<string> {
    const client = await this.getClient();

    const contextLines: string[] = [`Linguagem: ${params.languageId}`];

    if (params.enclosing) {
      contextLines.push(
        `Cursor dentro de: ${params.enclosing.kind} ${params.enclosing.name}${params.enclosing.signature ? params.enclosing.signature : ''}`
      );
    }

    const local = (params.localContext ?? []).slice(0, 20);
    if (local.length > 0) {
      const lines = local.map((s) => `- ${s.kind} ${s.name}${s.signature ?? '()'} (${s.file})`);
      contextLines.push('Conectado diretamente (chama / é chamado por), use só esses nomes e assinaturas se for sugerir uma chamada:', ...lines);
    } else {
      const symbolNames = params.subgraph.nodes
        .filter((n) => n.attributes.kind !== 'file')
        .map((n) => n.attributes.name)
        .slice(0, 40);
      if (symbolNames.length > 0) contextLines.push(`Símbolos vizinhos no grafo: ${JSON.stringify(symbolNames)}`);
    }

    contextLines.push(
      '',
      'Código antes do cursor:',
      '```',
      params.prefix.slice(-1500),
      '```',
      'Código depois do cursor:',
      '```',
      params.suffix.slice(0, 300),
      '```'
    );

    const response = await client.messages.create({
      model: this.modelFor('fast'),
      max_tokens: 120,
      temperature: 0.1,
      system: INLINE_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: contextLines.join('\n') }],
    });

    return this.extractText(response)
      .replace(/^```[a-zA-Z]*\n?/, '')
      .replace(/```$/, '');
  }

  /**
   * Varredura leve automática — chamada pelo BackgroundAnalyzer a cada idle/paste, nunca por tecla.
   * Não exige os 5 testes (isso fica só para o comando manual `reviewChange`); retorna achados
   * estruturados para virarem Diagnostics nativos do VS Code.
   *
   * `text` pode ser o arquivo inteiro (primeira vez que o vemos) ou só o trecho que mudou desde
   * a última varredura — nesse segundo caso, `startLine` é o offset absoluto no arquivo real,
   * pra numeração continuar batendo mesmo analisando só um pedaço.
   */
  async scanForRisks(text: string, subgraph: GraphSnapshot, startLine = 0): Promise<RiskFinding[]> {
    const client = await this.getClient();

    const response = await client.messages.create({
      model: this.modelFor('fast'),
      max_tokens: 800,
      temperature: 0,
      system: `${SCAN_SYSTEM_PROMPT}\n\nOs campos "message" e "impact" devem ser escritos em ${getConfiguredLanguageName()}.`,
      messages: [
        {
          role: 'user',
          content: [
            startLine > 0
              ? `TRECHO ALTERADO DO ARQUIVO (numerado por linha, começando em ${startLine} — o resto do arquivo não mudou desde a última varredura e já foi verificado):`
              : 'ARQUIVO ATUAL (numerado por linha, 0-indexado):',
            '```',
            this.withLineNumbers(text, startLine),
            '```',
            '',
            'SUBGRAFO DE IMPACTO (nós e arestas adjacentes no grafo de arquitetura):',
            '```json',
            JSON.stringify(subgraph),
            '```',
          ].join('\n'),
        },
      ],
    });

    const raw = this.stripFences(this.extractText(response));
    if (!raw) {
      this.output.appendLine('[AnthropicService] varredura retornou texto vazio.');
      return [];
    }

    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        this.output.appendLine(`[AnthropicService] varredura não retornou um array: ${raw.slice(0, 300)}`);
        return [];
      }
      const findings = parsed.filter(isValidFinding);
      if (findings.length !== parsed.length) {
        this.output.appendLine(
          `[AnthropicService] varredura: ${parsed.length - findings.length} item(ns) descartado(s) por formato inválido. Bruto: ${raw.slice(0, 300)}`
        );
      }
      return findings;
    } catch (err) {
      this.output.appendLine(`[AnthropicService] resposta de varredura não era JSON válido: ${err}. Bruto: ${raw.slice(0, 300)}`);
      return [];
    }
  }

  /** Conversa livre no painel de chat — Q&A sobre erros, pedidos de correção, ou resumo de uma varredura completa. */
  async chat(context: ChatContext): Promise<string> {
    const client = await this.getClient();

    const contextParts: string[] = [];
    if (context.activeFile) {
      contextParts.push(
        `ARQUIVO ATIVO: ${context.activeFile.path}`,
        '```',
        this.withLineNumbers(context.activeFile.text),
        '```'
      );
    }
    if (context.findings && context.findings.length > 0) {
      contextParts.push(
        'PROBLEMAS JÁ DETECTADOS NESTE ARQUIVO (cite pelo #id ao responder):',
        JSON.stringify(context.findings)
      );
    }
    if (context.subgraph) {
      contextParts.push('SUBGRAFO DE IMPACTO (dependências/chamadas vizinhas):', JSON.stringify(context.subgraph));
    }

    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    if (contextParts.length > 0) {
      messages.push({ role: 'user', content: contextParts.join('\n') });
      messages.push({ role: 'assistant', content: 'Entendido, tenho o contexto do arquivo atual.' });
    }
    messages.push(...context.history);

    const response = await client.messages.create({
      model: this.modelFor('deep'),
      max_tokens: 4000,
      system: buildChatSystemPrompt(),
      messages,
    });

    return this.extractText(response);
  }

  private withLineNumbers(text: string, startLine = 0): string {
    return text
      .split('\n')
      .map((line, i) => `${startLine + i}: ${line}`)
      .join('\n');
  }

  private stripFences(text: string): string {
    return text
      .trim()
      .replace(/^```[a-zA-Z]*\n?/, '')
      .replace(/```$/, '')
      .trim();
  }

  /**
   * Ordem de busca da chave: SecretStorage (global, criptografado, funciona em qualquer
   * workspace) → setting de workspace (legado, só vale pro projeto onde foi definida) →
   * variável de ambiente. A maioria dos usuários deveria só rodar o comando
   * "ShielDepy: Configurar Chave da API" uma vez e nunca mais pensar nisso.
   */
  private async getClient(): Promise<Anthropic> {
    if (this.client) return this.client;

    const apiKey =
      (await this.secrets.get(API_KEY_SECRET_KEY)) ||
      vscode.workspace.getConfiguration('shieldepy').get<string>('anthropicApiKey') ||
      process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      throw new Error(
        'Chave da API não configurada. Rode o comando "ShielDepy: Configurar Chave da API" (Ctrl+Shift+P).'
      );
    }

    this.client = new Anthropic({ apiKey });
    return this.client;
  }

  /** Chame depois de salvar uma chave nova — descarta o client cacheado com a chave antiga. */
  invalidateClient(): void {
    this.client = undefined;
  }

  private modelFor(tier: ModelTier): string {
    const cfg = vscode.workspace.getConfiguration('shieldepy');
    return tier === 'deep'
      ? cfg.get<string>('deepModel', 'claude-haiku-4-5-20251001')
      : cfg.get<string>('fastModel', 'claude-haiku-4-5-20251001');
  }

  private extractText(response: Anthropic.Message): string {
    return response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n');
  }
}

function isValidFinding(value: unknown): value is RiskFinding {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.startLine === 'number' &&
    typeof candidate.endLine === 'number' &&
    typeof candidate.message === 'string' &&
    (candidate.impact === undefined || typeof candidate.impact === 'string') &&
    (candidate.severity === 'error' || candidate.severity === 'warning' || candidate.severity === 'info')
  );
}

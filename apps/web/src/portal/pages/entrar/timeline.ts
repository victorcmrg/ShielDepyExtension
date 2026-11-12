// Roteiro da encenação do "Entrar" (decisão 0039): um 404 de mentira e o ShielDepy reconstruindo a
// tela de login por cima. Só dados e funções puras, sem DOM: a página (Entrar.tsx) lê daqui o que
// mostrar em cada instante, e o teste confere a duração e a ordem.

/** Quanto tempo o 404 "quebrado" fica sozinho na tela antes da reconstrução começar. */
export const NOT_FOUND_MS = 1500;

/** Os blocos da tela de login, cada um com o seu defeito encenado. */
export type BlockId = 'logo' | 'title' | 'subtitle' | 'card' | 'email' | 'password' | 'button' | 'back';
export const BLOCKS: readonly BlockId[] = ['logo', 'title', 'subtitle', 'card', 'email', 'password', 'button', 'back'];

/**
 * Etapas da tela inteira, na ordem: o 404 marcado como erro, o esqueleto quebrado no lugar dele, as
 * fontes, as cores, o acabamento (sombra e foco) e o fim da varredura.
 */
export type Stage = 'marked' | 'skeleton' | 'fonts' | 'colors' | 'polish' | 'clean';
export const STAGES: readonly Stage[] = ['marked', 'skeleton', 'fonts', 'colors', 'polish', 'clean'];

export type Tone = 'cmd' | 'err' | 'info' | 'ok';
export interface LogLine {
  text: string;
  tone: Tone;
}

export interface RebuildEvent {
  /** Milissegundos depois do fim do 404. */
  at: number;
  log?: LogLine;
  fix?: BlockId;
  stage?: Stage;
}

/** O título começa embaralhado e se "decodifica" ao ser corrigido. */
export const TITLE_BROKEN = 'Entarr na cnota';
export const TITLE_FIXED = 'Entrar na conta';
/** Quanto dura a decodificação do título, a partir da correção dele. */
export const DECODE_MS = 420;

export const EVENTS: readonly RebuildEvent[] = [
  { at: 0, stage: 'marked', log: { tone: 'cmd', text: '$ shieldepy vigiar --rota /entrar' } },
  { at: 350, log: { tone: 'err', text: '✗ erro detectado: GET /entrar → 404' } },
  { at: 800, log: { tone: 'err', text: '✗ rota /login sem componente montado' } },
  { at: 1150, stage: 'skeleton', log: { tone: 'info', text: '→ montando <Login /> a partir do mapa' } },
  { at: 1600, log: { tone: 'err', text: `✗ ${BLOCKS.length} blocos com defeito na tela` } },
  { at: 1950, fix: 'title', log: { tone: 'ok', text: `✓ título: "${TITLE_BROKEN}" → "${TITLE_FIXED}"` } },
  { at: 2350, fix: 'logo', log: { tone: 'ok', text: '✓ logo: /logo-mark.svg carregado' } },
  { at: 2700, stage: 'fonts', log: { tone: 'info', text: '→ corrigindo estilos: fontes Manrope e Inter' } },
  { at: 3050, fix: 'email', log: { tone: 'ok', text: '✓ campo e-mail: alinhado (estava 38 px fora)' } },
  { at: 3400, fix: 'password', log: { tone: 'ok', text: '✓ campo senha: type=text → type=password' } },
  { at: 3750, stage: 'colors', log: { tone: 'info', text: '→ aplicando tokens de cor (--background, --surface)' } },
  { at: 4100, fix: 'card', log: { tone: 'ok', text: '✓ cartão: borda, raio de 24 px e espaçamento' } },
  { at: 4450, fix: 'subtitle', log: { tone: 'ok', text: '✓ subtítulo: o texto não está mais cortado' } },
  { at: 4800, fix: 'button', log: { tone: 'ok', text: '✓ botão: gradiente da marca aplicado' } },
  { at: 5150, fix: 'back', log: { tone: 'ok', text: '✓ link de volta: cor e acento corrigidos' } },
  { at: 5500, stage: 'polish', log: { tone: 'info', text: '→ sombra e anel de foco' } },
  { at: 5900, stage: 'clean', log: { tone: 'ok', text: '✓ 0 erros · tela de login reconstruída' } },
];

/** Fim da reconstrução: daqui em diante a tela é a de login pronta. */
export const REBUILD_MS = 6500;

/** Quantos eventos já aconteceram depois de `elapsed` ms da reconstrução. */
export function stepAt(elapsed: number): number {
  let n = 0;
  while (n < EVENTS.length && EVENTS[n]!.at <= elapsed) n++;
  return n;
}

export interface Snapshot {
  fixed: ReadonlySet<BlockId>;
  stages: ReadonlySet<Stage>;
  logs: readonly LogLine[];
}

/** O que está na tela depois dos primeiros `step` eventos. */
export function snapshot(step: number): Snapshot {
  const fixed = new Set<BlockId>();
  const stages = new Set<Stage>();
  const logs: LogLine[] = [];
  for (const e of EVENTS.slice(0, step)) {
    if (e.fix) fixed.add(e.fix);
    if (e.stage) stages.add(e.stage);
    if (e.log) logs.push(e.log);
  }
  return { fixed, stages, logs };
}

/** Momento (ms da reconstrução) em que o bloco é corrigido. */
export function fixTime(block: BlockId): number {
  const e = EVENTS.find((ev) => ev.fix === block);
  if (!e) throw new Error(`bloco sem correção no roteiro: ${block}`);
  return e.at;
}

/** Momento (ms da reconstrução) em que a etapa começa. */
export function stageTime(stage: Stage): number {
  const e = EVENTS.find((ev) => ev.stage === stage);
  if (!e) throw new Error(`etapa sem lugar no roteiro: ${stage}`);
  return e.at;
}

/** Timecode de cinema (minutos:segundos:quadros, a 24 quadros por segundo). */
export function timecode(ms: number): string {
  const total = Math.max(0, Math.floor((ms / 1000) * 24));
  const frames = total % 24;
  const secs = Math.floor(total / 24) % 60;
  const mins = Math.floor(total / (24 * 60));
  const two = (n: number) => String(n).padStart(2, '0');
  return `${two(mins)}:${two(secs)}:${two(frames)}`;
}

const NOISE = '#%&*/<>?{}[]=+_01';

/**
 * Texto no meio da decodificação: as letras certas entram da esquerda para a direita e o resto
 * ainda é o texto quebrado ou um caractere de ruído. `progress` vai de 0 (quebrado) a 1 (certo).
 * O ruído vem de `seed`, para o mesmo instante dar o mesmo texto.
 */
export function decodeFrame(from: string, to: string, progress: number, seed = 0): string {
  const p = Math.min(1, Math.max(0, progress));
  if (p >= 1) return to;
  const len = Math.max(from.length, to.length);
  const settled = Math.floor(p * len);
  let out = '';
  for (let i = 0; i < len; i++) {
    if (i < settled) out += to[i] ?? '';
    else if (i < settled + 3 && p > 0) out += NOISE[(i * 7 + seed) % NOISE.length];
    else out += from[i] ?? '';
  }
  return out.trimEnd();
}

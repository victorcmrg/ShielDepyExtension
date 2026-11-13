// Visualizador do mapa do sistema (Cytoscape.js + layout fcose). Dois modos:
//   - `inline`: HTML autocontido, bibliotecas e dados embutidos — a CLI grava e abre offline;
//   - `webview`: a extensão do VS Code serve as bibliotecas como recursos do webview, com CSP
//     por nonce (nada inline sem nonce), e ganha o botão "Abrir código" (postMessage → editor).
// Nasceu como ferramenta de CONFERÊNCIA do mapeamento (E1); a E2 pôs rotas e operações de I/O
// como nós, e o V2 põe por cima o resultado do caos e o diff do PR (`ViewerOverlay`).

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { MapDiff, SystemGraph, TopologyGraph } from '@shieldepy/core';
import libraries from '../libraries.json' with { type: 'json' };

/**
 * Cytoscape + fcose (feito pra grafos com nós compostos — arquivo contendo símbolos), na ordem
 * de dependência; o fcose se registra sozinho ao achar o `cytoscape` global. A lista mora em
 * `libraries.json` porque o build da extensão (apps/vscode/esbuild.mjs) também a lê, pra copiar
 * cada arquivo pra `media/vendor/<file>`. O `exports` do cytoscape mapeia `./dist/*` → `./dist/*.js`,
 * por isso o especificador dele vai sem extensão.
 */
export const VIEWER_LIBRARIES: ReadonlyArray<{ specifier: string; file: string }> = libraries;

/** Caminhos em disco das bibliotecas (resolvidos a partir deste pacote). */
export function viewerLibraryPaths(): string[] {
  // createRequire só aqui dentro: no bundle CJS da extensão `import.meta.url` não existe
  const require = createRequire(import.meta.url);
  return VIEWER_LIBRARIES.map((lib) => require.resolve(lib.specifier));
}

/**
 * Posições já calculadas, por combinação de filtros: `{ [filtros]: { [id do nó]: [x, y] } }`.
 * O fcose leva segundos num projeto grande; reaplicar posições leva décimos. Quem guarda é a
 * extensão (enquanto ela vive) ou o `localStorage` do navegador (HTML da CLI).
 */
export type ViewerLayout = Record<string, Record<string, [number, number]>>;

export type ViewerMode =
  | { kind: 'inline' }
  | {
      kind: 'webview';
      /** URIs (asWebviewUri) das bibliotecas, na ordem de VIEWER_LIBRARIES. */
      libraryUris: string[];
      nonce: string;
      cspSource: string;
      /** Posições guardadas de uma abertura anterior (o webview manda `{ type: 'layout' }` ao calcular). */
      layout?: ViewerLayout;
      /** Tema escolhido no botão sol/lua (o webview manda `{ type: 'theme' }`); sem ele, segue o VS Code. */
      theme?: 'light' | 'dark';
    };

/**
 * Resultado do caos (o `.shieldepy/chaos-results.json` da CLI), no formato mínimo que o
 * visualizador lê. É estruturalmente o `ChaosResults` do `@shieldepy/agent/chaos`, declarado
 * aqui para o visualizador não depender do pacote de agentes (que puxa o LangGraph).
 */
export interface ViewerChaos {
  project: string;
  topologyHash: string;
  /**
   * Resultado desatualizado, decidido por quem chama. A extensão monta o mapa a partir da raiz do
   * workspace, e a CLI a partir da pasta do projeto, então o hash não serve lá: ela compara a data do
   * resultado com a do código. Sem isto, vale a comparação de `topologyHash` (CLI).
   */
  stale?: boolean;
  ran: boolean;
  runError?: string;
  failOn: string;
  hits: number;
  scope?: { base: string; commit: string; all?: string; tested: string[]; affected: { id: string; why: string[] }[]; untouched: string[] };
  outcomes: { hypothesisId: string; routeId: string; failure: string; target: string; status: 'passed' | 'failed' | 'invalid'; notApplicable?: boolean; severity?: string; message?: string; durationMs: number; testFile: string }[];
  untested: { id: string; routeId: string; failure: string; target: string; reason: string }[];
}

/** O que vai por cima do mapa (V2): o resultado do caos e o diff do PR. */
export interface ViewerOverlay {
  chaos?: ViewerChaos;
  diff?: {
    base: string;
    commit: string;
    diff: MapDiff;
    /** Rotas tocadas pelo PR, com o motivo (sem o caos, vem do `affectedRoutes`). */
    routes?: { all?: string; affected: { id: string; why: string[] }[]; untouched: string[] };
  };
}

/** JSON seguro dentro de <script>: `<` vira `<` (no JSON, `<` só aparece dentro de strings). */
function embedJson(value: unknown): string {
  return JSON.stringify(value).split('<').join('<');
}

function escapeHtml(text: string): string {
  return text.split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;').split('"').join('&quot;');
}

const ICON_SEARCH = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10.4 10.4 14 14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
const ICON_SUN =
  '<svg class="sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.2" fill="currentColor"/><g stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M12 2.6v2.3M12 19.1v2.3M2.6 12h2.3M19.1 12h2.3M5.35 5.35l1.63 1.63M17.02 17.02l1.63 1.63M5.35 18.65l1.63-1.63M17.02 6.98l1.63-1.63"/></g></svg>';
const ICON_MOON = '<svg class="moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.2 14.6A8.4 8.4 0 0 1 9.4 3.8a8.4 8.4 0 1 0 10.8 10.8Z" fill="currentColor"/></svg>';

/** Uma linha de filtro: o texto (com a amostra da linha, se houver) e o switch. */
function toggle(attr: string, text: string, checked: boolean, swatch = ''): string {
  return `<label class="toggle"><span class="toggle-text">${swatch ? `<span class="sw ${swatch}"></span>` : ''}${text}</span><input type="checkbox" ${attr}${checked ? ' checked' : ''}><span class="switch" aria-hidden="true"></span></label>`;
}

/**
 * Com `topology`, o mapa ganha as rotas e as operações de I/O como nós (rota → handlers → ... →
 * `db_write stock`) e uma lista de rotas que abre o fluxo de cada uma.
 */
export function renderGraphHtml(
  system: SystemGraph,
  label: string,
  mode: ViewerMode = { kind: 'inline' },
  topology?: TopologyGraph,
  overlay: ViewerOverlay = {}
): string {
  const nonce = mode.kind === 'webview' ? ` nonce="${mode.nonce}"` : '';
  const csp =
    mode.kind === 'webview'
      ? `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${mode.cspSource} data:; style-src 'nonce-${mode.nonce}'; script-src 'nonce-${mode.nonce}' ${mode.cspSource};">`
      : '';
  const libraries =
    mode.kind === 'webview'
      ? mode.libraryUris.map((uri) => `<script${nonce} src="${escapeHtml(uri)}"></script>`).join('\n')
      : viewerLibraryPaths()
          .map((file) => `<script>${readFileSync(file, 'utf8').split('</script').join('<\/script')}</script>`)
          .join('\n');
  const saved = mode.kind === 'webview' ? { layout: mode.layout ?? null, theme: mode.theme ?? null } : { layout: null, theme: null };
  const theme = saved.theme ? ` data-theme="${saved.theme}"` : '';

  return `<!doctype html>
<html lang="pt-BR"${theme}>
<head>
<meta charset="utf-8">
${csp}
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mapa — ${escapeHtml(label)}</title>
<style${nonce}>${STYLE}</style>
<!-- o Cytoscape injeta este <style> se ele não existir; a CSP do webview bloquearia a injeção -->
<style${nonce} id="__________cytoscape_stylesheet">.__________cytoscape_container { position: relative; }</style>
</head>
<body>
<aside id="side" aria-label="Painel do mapa">
  <header class="head">
    <h1>Mapa do sistema</h1>
    <p class="sub" id="label">${escapeHtml(label)}</p>
  </header>
  <div class="search">
    ${ICON_SEARCH}
    <input id="search" type="search" placeholder="Buscar símbolo ou arquivo" aria-label="Buscar símbolo ou arquivo (Enter)" autocomplete="off" spellcheck="false">
  </div>
  <p class="hint" id="searchHint" hidden></p>
  <section id="details" class="card" hidden></section>
  <section id="chaos" hidden></section>
  <section id="diff" hidden></section>
  <section id="coverage"></section>
  <section class="filters" aria-labelledby="filtersTitle">
    <div class="sec-head"><h2 id="filtersTitle">Exibir</h2></div>
    ${overlay.diff ? `<div class="group">${toggle('data-filter="changed"', 'Só o que o PR mudou e os vizinhos', false)}</div>` : ''}
    <p class="group-label">Ligações</p>
    <div class="group">
      ${topology ? toggle('data-filter="routes"', 'Rotas e operações de I/O', true, 'route') : ''}
      ${toggle('data-filter="calls"', 'Chamadas', true, 'calls')}
      ${toggle('data-filter="references"', 'Referências (handler passado como valor)', true, 'references')}
      ${toggle('data-filter="imports"', 'Imports entre arquivos', false, 'imports')}
    </div>
    <p class="group-label">Elementos</p>
    <div class="group">
      ${toggle('data-filter="packages"', 'Pacotes externos', true)}
      ${toggle('data-filter="tests"', 'Arquivos de teste', false)}
      ${toggle('data-filter="isolated"', 'Símbolos sem ligação', false)}
      ${toggle('id="group"', 'Agrupar símbolos por arquivo', true)}
    </div>
    <p class="legend"><span class="sw heuristic"></span>Tracejado laranja: chamada ligada só pelo nome (heurística)</p>
  </section>
  <section id="routes" hidden></section>
  <section id="weak"></section>
  <footer class="foot">Hash do mapa <code id="hash"></code></footer>
</aside>
<main id="stage">
  <div id="flowbar" hidden><button id="back" class="btn" type="button">Voltar ao mapa</button><span id="flowtitle"></span></div>
  <div class="canvas"><div id="cy" aria-label="Grafo do sistema"></div><div id="flow" aria-label="Fluxo escolhido" hidden></div><div id="pulses" aria-hidden="true"></div></div>
  <div id="loading" class="loading" role="status"><span class="blob"></span><span>Montando o mapa…</span></div>
  <button id="theme" class="theme" type="button" aria-label="Mudar para o tema claro" title="Mudar para o tema claro">${ICON_SUN}${ICON_MOON}</button>
</main>
${libraries}
<script${nonce}>const SYSTEM = ${embedJson(system)}; const TOPOLOGY = ${embedJson(topology ?? null)}; const OVERLAY = ${embedJson(overlay)}; const SAVED = ${embedJson(saved)};</script>
<script${nonce}>${APP}</script>
</body>
</html>
`;
}

// As cores do grafo são as de antes (o desenho não muda); as da interface seguem os tokens da
// extensão (common.css): verde-guarda, hortelã e o semáforo do macOS.
const LIGHT = `
  --bg: #f5f6f7; --panel: #ffffff; --text: #1d1d1f; --muted: #6b6b72;
  --line: rgba(0, 0, 0, 0.09); --fill: rgba(0, 0, 0, 0.045); --fill-strong: rgba(0, 0, 0, 0.085); --shadow: rgba(0, 0, 0, 0.12);
  --green: #0b9e55; --on-green: #ffffff; --mint: #1f9d63; --red: #e5484d; --yellow: #c98a00; --route-ui: #c2255c;
  --file: #eef2f7; --file-border: #c9d3e0; --fn: #2f6fdf; --method: #7a4fd1; --class: #0f8a6a;
  --pkg: #b5651d; --calls: #4a5568; --refs: #2f6fdf; --imports: #b9bcc4; --heur: #e0861a;
  --hl: #e5484d; --accent: #2f6fdf; --route: #c2255c; --db: #0b7285; --api: #d9480f;
  --g-bad: #d92d20; --g-ok: #12854a; --g-warn: #b54708;
  color-scheme: light;`;
const DARK = `
  --bg: #141416; --panel: #1c1c1f; --text: #ececee; --muted: #9a9aa2;
  --line: rgba(255, 255, 255, 0.08); --fill: rgba(255, 255, 255, 0.05); --fill-strong: rgba(255, 255, 255, 0.09); --shadow: rgba(0, 0, 0, 0.45);
  --green: #10ef7c; --on-green: #04210f; --mint: #a8f5cb; --red: #ff5f57; --yellow: #febc2e; --route-ui: #f06595;
  --file: #22262e; --file-border: #3a4150; --fn: #6aa0ff; --method: #b294ff; --class: #3fcf9f;
  --pkg: #e3a15c; --calls: #a0a7b4; --refs: #6aa0ff; --imports: #4a4e57; --heur: #f0a040;
  --hl: #ff6b6f; --accent: #6aa0ff; --route: #f06595; --db: #3bc9db; --api: #ff922b;
  --g-bad: #ff6b6b; --g-ok: #4ad685; --g-warn: #f5a524;
  color-scheme: dark;`;

const STYLE = `
body {
  --font: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif;
  --radius: 10px;
  --ease: cubic-bezier(0.2, 0.8, 0.2, 1);
  --spring: cubic-bezier(0.34, 1.4, 0.64, 1);
  ${LIGHT}
}
/* Sem escolha no botão: segue o VS Code (classe do body) e, fora dele, o sistema. */
@media (prefers-color-scheme: dark) { html:not([data-theme]) body:not(.vscode-light):not(.vscode-high-contrast-light) { ${DARK} } }
html:not([data-theme]) body.vscode-dark, html:not([data-theme]) body.vscode-high-contrast:not(.vscode-high-contrast-light), html[data-theme="dark"] body { ${DARK} }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
html, body { height: 100%; margin: 0; }
/* A página não rola: quem rola é o painel lateral, e o grafo tem o próprio pan. */
html { overflow: hidden; }
body { display: flex; overflow: hidden; background: var(--bg); color: var(--text); font: 12.5px/1.45 var(--font); -webkit-font-smoothing: antialiased; }
:focus-visible { outline: 2px solid var(--green); outline-offset: 2px; }
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { border: 3px solid transparent; border-radius: 999px; background-clip: padding-box; background-color: var(--fill-strong); }

#side { width: 320px; flex: none; overflow-y: auto; background: var(--panel); border-right: 1px solid var(--line); padding: 18px 14px 14px; display: flex; flex-direction: column; gap: 18px; scrollbar-gutter: stable; }
#stage { position: relative; flex: 1; min-width: 0; display: flex; flex-direction: column; background: var(--bg); }
.canvas { position: relative; flex: 1; min-height: 0; overflow: hidden; }
#cy, #flow { position: absolute; inset: 0; }
#flow { background: var(--bg); }
#cy.panning, #cy.panning *, #flow.panning, #flow.panning * { cursor: grabbing !important; }/* Pulse dos nós com erro: camada HTML por cima do grafo, animada só com transform/opacity
   (fica no compositor; o Cytoscape não redesenha nada por causa dela). */
#pulses { position: absolute; inset: 0; z-index: 2; overflow: hidden; pointer-events: none; }
.pulse { position: absolute; left: 0; top: 0; will-change: transform; transition: opacity 0.2s var(--ease); }
.pulse::before, .pulse::after { content: ""; position: absolute; inset: 0; border-radius: 50%; box-shadow: 0 0 0 2px var(--g-bad), 0 0 10px 2px color-mix(in srgb, var(--g-bad) 55%, transparent); opacity: 0; animation: node-pulse 2.4s cubic-bezier(0.2, 0.6, 0.3, 1) infinite; }
.pulse::after { animation-delay: 1.2s; }
.pulse.dim { opacity: 0.1; }
@keyframes node-pulse { 0% { transform: scale(0.9); opacity: 0.55; } 100% { transform: scale(2.1); opacity: 0; } }

.head h1 { font-size: 15px; font-weight: 650; letter-spacing: -0.01em; margin: 0; }
.head .sub { margin: 2px 0 0; color: var(--muted); overflow-wrap: anywhere; }
.search { position: relative; margin-top: -6px; }
.search svg { position: absolute; left: 10px; top: 9px; width: 14px; height: 14px; color: var(--muted); pointer-events: none; }
.search input { width: 100%; height: 32px; padding: 0 10px 0 31px; border-radius: 8px; border: 1px solid transparent; background: var(--fill); color: var(--text); font: inherit; outline: none; transition: border-color 0.2s var(--ease), background 0.2s var(--ease); }
.search input::placeholder { color: var(--muted); }
.search input:focus { border-color: var(--green); background: var(--panel); }
.hint { margin: -12px 2px 0; font-size: 11.5px; color: var(--muted); }

section { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.sec-head { display: flex; align-items: baseline; gap: 8px; }
h2 { font-size: 13px; font-weight: 600; letter-spacing: -0.01em; margin: 0; }
.sec-meta { margin-left: auto; font-size: 11.5px; color: var(--muted); text-align: right; overflow-wrap: anywhere; }
.count { margin-left: auto; font-size: 11.5px; font-weight: 600; color: var(--muted); font-variant-numeric: tabular-nums; }
.note { margin: 0; font-size: 11.5px; color: var(--muted); overflow-wrap: anywhere; }

/* Lista agrupada, como a lista de problemas do painel. */
.group { border-radius: var(--radius); background: var(--fill); overflow: hidden; }
.group > * + * { border-top: 1px solid var(--line); }
.group-label { margin: 2px 2px -4px; font-size: 11.5px; color: var(--muted); }
.row-btn { display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 10px; border: 0; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; transition: background 0.15s ease; }
.row-btn:hover { background: var(--fill); }
.row-btn:active { background: var(--fill-strong); }
.row-main { flex: 1; min-width: 0; }
.row-title { display: block; font-weight: 600; overflow-wrap: anywhere; }
.row-sub { display: block; font-size: 11px; color: var(--muted); overflow-wrap: anywhere; }
.method { margin-right: 6px; font-size: 10.5px; font-weight: 700; color: var(--route-ui); }
.chevron { width: 6px; height: 6px; flex: none; border-right: 1.5px solid var(--muted); border-bottom: 1.5px solid var(--muted); transform: rotate(-45deg); }

/* Formas do semáforo: quadrado vermelho, triângulo amarelo, círculo verde. */
.shape { display: inline-block; width: 9px; height: 9px; flex: none; }
.shape.bad { background: var(--red); border-radius: 2px; }
.shape.warn { background: var(--yellow); clip-path: polygon(50% 4%, 100% 96%, 0% 96%); }
.shape.ok { background: var(--green); border-radius: 50%; }
.shape.off { border: 1.5px dashed var(--muted); border-radius: 50%; }

/* position: relative segura o input escondido aqui dentro; sem isso ele se posiciona pela
   página e, com o painel rolado, empurrava a página para além do fim. */
.toggle { position: relative; display: flex; align-items: center; gap: 10px; padding: 7px 10px; cursor: pointer; }
.toggle:hover { background: var(--fill); }
.toggle-text { flex: 1; display: flex; align-items: center; gap: 8px; min-width: 0; }
.toggle input { position: absolute; opacity: 0; width: 1px; height: 1px; margin: 0; pointer-events: none; }
.switch { position: relative; width: 30px; height: 18px; flex: none; border-radius: 999px; background: var(--fill-strong); transition: background 0.25s var(--ease); }
.switch::before { content: ""; position: absolute; left: 2px; top: 2px; width: 14px; height: 14px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3); transition: transform 0.4s var(--spring); }
.toggle input:checked + .switch { background: var(--green); }
.toggle input:checked + .switch::before { transform: translateX(12px); }
.toggle input:focus-visible + .switch { outline: 2px solid var(--green); outline-offset: 2px; }
.sw { display: inline-block; width: 16px; height: 0; border-top: 2px solid; flex: none; }
.sw.calls { border-color: var(--calls); }
.sw.references { border-color: var(--refs); border-top-style: dashed; }
.sw.imports { border-color: var(--imports); }
.sw.heuristic { border-color: var(--heur); border-top-style: dashed; }
.sw.route { border-color: var(--route); border-top-width: 3px; }
.legend { display: flex; align-items: center; gap: 8px; margin: 0 2px; font-size: 11.5px; color: var(--muted); }

.tiles { display: grid; gap: 6px; }
.tiles.three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.tiles.four { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.tile { min-width: 0; padding: 8px 9px 7px; border-radius: var(--radius); background: var(--fill); }
.tile b { display: block; font-size: 17px; font-weight: 600; letter-spacing: -0.02em; line-height: 1.15; font-variant-numeric: tabular-nums; }
.tile span { display: block; font-size: 11px; line-height: 1.25; color: var(--muted); overflow-wrap: anywhere; }
.tiles.four .tile { display: flex; align-items: baseline; gap: 6px; padding: 7px 10px; }
.tiles.four .tile b, .tiles.four .tile span { display: inline; }
.tiles.four .tile span { font-size: 11.5px; }
.tiles.four .tile:last-child:nth-child(odd) { grid-column: 1 / -1; }
.tile.bad b { color: var(--red); }
.tile.ok b { color: var(--green); }
/* Cartões do caos viram filtro do grafo (como os do painel da extensão). */
button.tile { --c: var(--muted); border: 0; color: inherit; font: inherit; text-align: left; cursor: pointer; transition: background 0.15s ease, opacity 0.2s var(--ease), box-shadow 0.2s var(--ease), transform 0.35s var(--spring); }
button.tile.bad { --c: var(--red); }
button.tile.ok { --c: var(--green); }
button.tile:hover:not(:disabled) { background: var(--fill-strong); }
button.tile:active:not(:disabled) { transform: scale(0.96); transition-duration: 0.08s; }
button.tile:disabled { cursor: default; }
button.tile[aria-pressed="true"] { background: color-mix(in srgb, var(--c) 16%, transparent); box-shadow: inset 0 0 0 1.5px var(--c); }
button.tile[aria-pressed="true"] span { color: var(--text); }
.tiles.filtering button.tile[aria-pressed="false"] { opacity: 0.45; }

.cov { display: flex; align-items: baseline; gap: 10px; }
.big { font-size: 26px; font-weight: 650; letter-spacing: -0.03em; line-height: 1; font-variant-numeric: tabular-nums; }
.cov-sub { font-size: 11.5px; color: var(--muted); }
.bar { display: flex; gap: 2px; height: 6px; border-radius: 999px; overflow: hidden; background: var(--fill-strong); }
.seg { height: 100%; flex: none; }
.seg.ok { background: var(--green); }
.seg.warn { background: var(--yellow); }
.seg.bad { background: var(--red); }
.keys { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 11.5px; color: var(--muted); }
.keys li { display: flex; align-items: center; gap: 6px; }
.keys b { color: var(--text); font-weight: 600; font-variant-numeric: tabular-nums; }
.facts { display: grid; grid-template-columns: 1fr auto; gap: 3px 12px; margin: 0; padding: 8px 10px; border-radius: var(--radius); background: var(--fill); font-size: 12px; }
.facts dt { color: var(--muted); }
.facts dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; }

.banner { padding: 8px 10px; border-radius: 8px; font-size: 12px; }
.banner.bad { background: color-mix(in srgb, var(--red) 14%, transparent); color: var(--red); }
.banner.ok { background: color-mix(in srgb, var(--green) 13%, transparent); color: var(--green); }
.banner.warn { background: color-mix(in srgb, var(--yellow) 15%, transparent); color: var(--yellow); }
.finding { border-radius: var(--radius); background: var(--fill); box-shadow: inset 3px 0 0 var(--red); overflow: hidden; }
.finding.alto { box-shadow: inset 3px 0 0 var(--yellow); }
.finding .row-btn { align-items: flex-start; padding-left: 13px; }
.finding .sev { font-weight: 700; color: var(--red); margin-right: 4px; }
.finding.alto .sev { color: var(--yellow); }
.finding code { display: block; margin-top: 2px; font-size: 11px; color: var(--muted); overflow-wrap: anywhere; }
.finding .actions { padding: 0 10px 9px 13px; }

details.fold > summary { display: flex; align-items: center; gap: 8px; padding: 4px 2px; list-style: none; cursor: pointer; font-weight: 600; }
details.fold > summary::-webkit-details-marker { display: none; }
details.fold > summary .chevron { transition: transform 0.35s var(--spring); }
details.fold[open] > summary .chevron { transform: rotate(45deg); }
details.fold > .group, details.fold > .stack { margin-top: 6px; }
.stack { display: flex; flex-direction: column; gap: 6px; }
.reason { padding: 8px 10px; font-size: 11.5px; color: var(--muted); overflow-wrap: anywhere; }
.reason b { color: var(--text); font-weight: 600; }

.btn { font: inherit; font-size: 12px; padding: 5px 10px; border: 0; border-radius: 8px; background: var(--fill-strong); color: var(--text); cursor: pointer; transition: background 0.15s ease, transform 0.35s var(--spring); }
.btn:hover { background: color-mix(in srgb, var(--text) 14%, transparent); }
.btn:active { transform: scale(0.97); transition-duration: 0.08s; }
.btn.primary { background: var(--green); color: var(--on-green); font-weight: 600; }
.btn.primary:hover { filter: brightness(1.06); }
.actions { display: flex; flex-wrap: wrap; gap: 6px; }
.icon-btn { display: grid; place-items: center; width: 24px; height: 24px; flex: none; margin: -2px -4px 0 auto; padding: 0; border: 0; border-radius: 50%; background: none; color: var(--muted); font-size: 16px; line-height: 1; cursor: pointer; }
.icon-btn:hover { background: var(--fill-strong); color: var(--text); }

.card { padding: 12px; border-radius: var(--radius); background: var(--fill); box-shadow: inset 0 0 0 1px var(--line); gap: 10px; }
.card-head { display: flex; align-items: flex-start; gap: 8px; }
.card-head h2 { overflow-wrap: anywhere; }
.kind { display: block; font-size: 11px; color: var(--muted); }
.card dl { display: grid; grid-template-columns: auto 1fr; gap: 3px 10px; margin: 0; font-size: 12px; }
.card dt { color: var(--muted); }
.card dd { margin: 0; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }

.foot { margin-top: auto; font-size: 11px; color: var(--muted); }
code { font-size: 11px; }

#flowbar { display: flex; align-items: center; gap: 12px; padding: 10px 60px 10px 12px; border-bottom: 1px solid var(--line); background: var(--panel); font-weight: 600; }
#flowtitle { min-width: 0; overflow-wrap: anywhere; }
.loading { position: absolute; inset: 0; display: grid; place-content: center; justify-items: center; gap: 10px; color: var(--muted); pointer-events: none; }
.loading .blob { width: 12px; height: 12px; border-radius: 50%; background: var(--green); animation: pulse 1.1s ease-in-out infinite; }
@keyframes pulse { 50% { transform: scale(0.6); opacity: 0.5; } }

/* Sol e lua: mostra o tema para onde o clique leva. */
.theme { position: absolute; top: 12px; right: 12px; z-index: 5; display: grid; place-items: center; width: 34px; height: 34px; padding: 0; border: 1px solid var(--line); border-radius: 50%; background: var(--panel); color: var(--text); cursor: pointer; box-shadow: 0 2px 10px var(--shadow); transition: transform 0.35s var(--spring), background 0.2s ease; }
.theme:hover { background: color-mix(in srgb, var(--text) 8%, var(--panel)); }
.theme:active { transform: scale(0.9); transition-duration: 0.08s; }
.theme svg { grid-area: 1 / 1; width: 17px; height: 17px; transition: transform 0.5s var(--spring), opacity 0.2s var(--ease); }
.theme .sun { color: var(--yellow); }
.theme .moon { transform: rotate(-90deg) scale(0.4); opacity: 0; }
html[data-theme="light"] .theme .sun { transform: rotate(90deg) scale(0.4); opacity: 0; }
html[data-theme="light"] .theme .moon { transform: none; opacity: 1; }

@media (max-width: 720px) {
  body { flex-direction: column; }
  #side { width: 100%; max-height: 45vh; border-right: 0; border-bottom: 1px solid var(--line); }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; }
  /* sem movimento: o anel fica parado, só marcando o nó */
  .pulse::before { animation: none !important; transform: scale(1.35); opacity: 0.45; }
  .pulse::after { display: none; }
}
`;

// Roda no navegador. Mantido como string pra o HTML sair num arquivo só, sem build.
const APP = String.raw`
(() => {
  const $ = (id) => document.getElementById(id);
  const isTest = (id) => id.includes('/test/') || id.includes('/tests/') || id.includes('.test.') || id.includes('.spec.') || id.includes('test-e2e/');
  const fileOf = (n) => (n.kind === 'file' ? n.id : n.file);
  const fmt = (n) => Number(n).toLocaleString('pt-BR');
  const plural = (n, one, many) => fmt(n) + ' ' + (n === 1 ? one : many);
  // dentro do webview do VS Code: o botão "Abrir código" fala com a extensão
  const vscodeApi = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : undefined;
  const state = { group: true, filters: { changed: false, routes: true, calls: true, references: true, imports: false, packages: true, tests: false, isolated: false } };
  const local = {
    get(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; } },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* armazenamento bloqueado: segue sem guardar */ } },
  };

  // ---- tema: o botão sol/lua escolhe; sem escolha, segue o VS Code (ou o sistema, fora dele)
  const THEME_KEY = 'shieldepy-map-theme';
  let manualTheme = SAVED.theme || (vscodeApi ? null : local.get(THEME_KEY));
  function autoTheme() {
    const b = document.body.classList;
    if (b.contains('vscode-light') || b.contains('vscode-high-contrast-light')) return 'light';
    if (b.contains('vscode-dark') || b.contains('vscode-high-contrast')) return 'dark';
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  const currentTheme = () => manualTheme || autoTheme();
  function applyTheme() {
    const theme = currentTheme();
    if (document.documentElement.dataset.theme === theme && main) return;
    document.documentElement.dataset.theme = theme;
    const text = theme === 'dark' ? 'Mudar para o tema claro' : 'Mudar para o tema escuro';
    $('theme').setAttribute('aria-label', text);
    $('theme').title = text;
    // a interface troca na hora; o grafo (que recalcula o estilo de cada elemento) logo depois
    if (main) setTimeout(() => {
      const st = makeStyle();
      main.style(st);
      if (cy && cy !== main) cy.style(st);
      const ov = overviewOf(main);
      if (ov) ov.clear();
    }, 0);
  }
  $('theme').onclick = () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    // voltar ao tema do VS Code é voltar a segui-lo
    manualTheme = next === autoTheme() ? null : next;
    if (vscodeApi) vscodeApi.postMessage({ type: 'theme', theme: manualTheme });
    else local.set(THEME_KEY, manualTheme);
    applyTheme();
  };
  new MutationObserver(() => { if (!manualTheme) applyTheme(); }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (!manualTheme) applyTheme(); });

  // ---- topologia (opcional): rota → handlers e símbolo → operação de I/O
  const routeId = (r) => 'route:' + r.id;
  const ioId = (o) => 'io:' + o.kind + ':' + o.target;
  const topo = { nodes: [], edges: [] };
  if (TOPOLOGY) {
    const seen = new Set();
    for (const r of TOPOLOGY.routes) {
      topo.nodes.push({ id: routeId(r), kind: 'route', name: r.id, route: r });
      for (const h of r.handlers) for (const s of h.symbols) topo.edges.push({ source: routeId(r), target: s, type: 'route' });
      for (const o of r.operations) {
        if (!seen.has(ioId(o))) {
          seen.add(ioId(o));
          topo.nodes.push({ id: ioId(o), kind: o.kind === 'api_call' ? 'io-api' : 'io-db', name: o.kind + ' ' + o.target, op: o });
        }
        topo.edges.push({ source: o.symbol, target: ioId(o), type: 'io' });
      }
    }
  }

  // ---- caos (V2): status de cada rota e alvos dos achados
  const CHAOS = OVERLAY.chaos || null;
  const routeChaos = new Map();
  const failedTargets = new Set();
  if (CHAOS) {
    // inválido não prova nada: a rota só fica inválida quando nenhum teste dela valeu
    const rank = { failed: 3, passed: 2, invalid: 1 };
    for (const o of CHAOS.outcomes) {
      const cur = routeChaos.get(o.routeId);
      if (!cur || rank[o.status] > rank[cur.status] || (o.status === 'failed' && o.severity === 'Crítico')) routeChaos.set(o.routeId, { status: o.status, severity: o.severity });
      if (o.status === 'failed') failedTargets.add(o.target);
    }
  }
  // ---- diff do PR (V2): o que mudou desde a base, e as rotas que isso tocou
  const DIFF = OVERLAY.diff || null;
  const diffSets = { added: new Set(), changed: new Set(), renamedFrom: new Map(), topChanged: new Set(), filesAdded: new Set() };
  const touchedRoutes = new Map();
  if (DIFF) {
    const d = DIFF.diff;
    d.symbols.added.forEach((id) => diffSets.added.add(id));
    d.symbols.changed.forEach((id) => diffSets.changed.add(id));
    d.symbols.renamed.forEach((r) => diffSets.renamedFrom.set(r.to, r.from));
    d.files.topChanged.forEach((id) => diffSets.topChanged.add(id));
    d.files.added.forEach((id) => diffSets.filesAdded.add(id));
  }
  const routesInfo = (DIFF && DIFF.routes) || (CHAOS && CHAOS.scope) || null;
  if (routesInfo) for (const a of routesInfo.affected) touchedRoutes.set(a.id, a.why);
  function diffKind(n) {
    if (n.kind === 'route') return touchedRoutes.has(n.name) ? 'route' : '';
    if (n.kind === 'file') return diffSets.filesAdded.has(n.id) ? 'added' : diffSets.topChanged.has(n.id) ? 'top' : '';
    if (diffSets.added.has(n.id)) return 'added';
    if (diffSets.renamedFrom.has(n.id)) return 'renamed';
    if (diffSets.changed.has(n.id)) return 'changed';
    return '';
  }

  /** Classes extras de um nó: status do caos na rota, alvo de achado, e o que o PR mudou. */
  function overlayClasses(n) {
    const c = [];
    const dk = DIFF || routesInfo ? diffKind(n) : '';
    if (dk) c.push('diff-' + dk);
    if (n.kind === 'route') {
      const st = routeChaos.get(n.name);
      if (st) c.push('chaos-' + st.status);
    }
    if ((n.kind === 'io-db' || n.kind === 'io-api') && failedTargets.has(n.op.target)) c.push('chaos-target');
    return c;
  }
  const chaosShape = (st) => (st ? (st.status === 'failed' ? 'bad' : st.status === 'passed' ? 'ok' : 'off') : '');

  // ---- cobertura: a porcentagem, a barra das três situações e o tamanho do mapa
  const s = SYSTEM.stats;
  const internal = s.callsResolved + s.callsHeuristic + s.callsUnresolved;
  const pct = internal === 0 ? 100 : (100 * s.callsResolved) / internal;
  $('hash').textContent = SYSTEM.contentHash.slice(0, 16);
  $('coverage').innerHTML =
    '<div class="sec-head"><h2>Cobertura das chamadas internas</h2></div>' +
    '<div class="cov"><span class="big">' + pct.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%</span><span class="cov-sub">das chamadas entre funções do projeto foram provadas</span></div>' +
    '<div class="bar" id="covbar"><span class="seg ok"></span><span class="seg warn"></span><span class="seg bad"></span></div>' +
    '<ul class="keys"><li><span class="shape ok"></span><b>' + fmt(s.callsResolved) + '</b> provadas</li><li><span class="shape warn"></span><b>' + fmt(s.callsHeuristic) + '</b> só pelo nome</li><li><span class="shape bad"></span><b>' + fmt(s.callsUnresolved) + '</b> sem alvo</li></ul>' +
    '<div class="tiles three"><div class="tile"><b>' + fmt(s.files) + '</b><span>arquivos</span></div><div class="tile"><b>' + fmt(s.symbols) + '</b><span>símbolos</span></div><div class="tile"><b>' + fmt(s.packages) + '</b><span>pacotes</span></div></div>' +
    '<dl class="facts"><dt>Chamadas para pacotes</dt><dd>' + fmt(s.callsExternal) + '</dd><dt>Imports quebrados</dt><dd>' + fmt(s.importsUnresolved) + '</dd>' +
    '<dt>Regras</dt><dd>' + fmt(s.rules) + '</dd><dt>Colisões entre regras</dt><dd>' + fmt(s.collisions) + '</dd></dl>';
  // largura via CSSOM: atributo style="" em HTML é bloqueado pela CSP do webview
  [s.callsResolved, s.callsHeuristic, s.callsUnresolved].forEach((n, i) => {
    const seg = $('covbar').children[i];
    if (internal === 0 || n === 0) seg.hidden = true;
    else seg.style.width = 'max(3px, ' + (100 * n) / internal + '%)';
  });

  // ---- elementos
  function elements() {
    const f = state.filters;
    const candidates = SYSTEM.nodes.filter((n) => {
      if (n.kind === 'file' && n.external) return false;
      if (!f.tests && isTest(fileOf(n) || '')) return false;
      if (n.kind === 'package' && !f.packages) return false;
      return true;
    });
    const withTopo = !!TOPOLOGY && f.routes;
    if (withTopo) candidates.push(...topo.nodes);
    const present = new Set(candidates.map((n) => n.id));
    const edges = SYSTEM.edges
      .concat(withTopo ? topo.edges : [])
      .filter((e) => e.type !== 'defines' && (f[e.type] || e.type === 'route' || e.type === 'io') && present.has(e.source) && present.has(e.target));
    let linked = new Set(edges.flatMap((e) => [e.source, e.target]));
    if (f.changed && DIFF) {
      const core = new Set(candidates.filter((n) => diffKind(n) !== '').map((n) => n.id));
      const keep = new Set(core);
      for (const e of edges) {
        if (core.has(e.source)) keep.add(e.target);
        if (core.has(e.target)) keep.add(e.source);
      }
      // arquivo fica se algum símbolo dele ficou (um passe, em vez de procurar os filhos a cada arquivo)
      const keptFiles = new Set();
      for (const n of candidates) if (n.file && keep.has(n.id)) keptFiles.add(n.file);
      const kept = candidates.filter((n) => keep.has(n.id) || (n.kind === 'file' && keptFiles.has(n.id)));
      candidates.length = 0;
      candidates.push(...kept);
      const still = new Set(kept.map((n) => n.id));
      const kEdges = edges.filter((e) => still.has(e.source) && still.has(e.target));
      edges.length = 0;
      edges.push(...kEdges);
      linked = new Set(edges.flatMap((e) => [e.source, e.target]).concat([...core]));
    }

    // símbolo sem nenhuma aresta visível só polui a leitura do fluxo (a menos que pedido)
    const nodes = candidates.filter((n) => n.kind === 'file' || f.isolated || linked.has(n.id));
    const usedFiles = new Set(nodes.filter((n) => n.file).map((n) => n.file));
    const out = [];
    for (const n of nodes) {
      // arquivo vira caixa só se tiver símbolo dentro ou aresta própria (ex.: references do topo)
      if (n.kind === 'file' && (!state.group || (!usedFiles.has(n.id) && !linked.has(n.id)))) continue;
      const st = n.kind === 'route' ? routeChaos.get(n.name) : undefined;
      const mark = st ? (st.status === 'failed' ? '✖ ' : st.status === 'passed' ? '✓ ' : '? ') : '';
      const data = { id: n.id, label: n.kind === 'file' ? n.id : mark + n.name, kind: n.kind, raw: n };
      if (state.group && n.file) data.parent = n.file;
      out.push({ group: 'nodes', data, classes: ['k-' + n.kind].concat(overlayClasses(n)).join(' ') });
    }
    const shown = new Set(out.map((e) => e.data.id));
    const edgeIds = new Set();
    for (const e of edges) {
      const id = e.source + '|' + e.type + '|' + e.target;
      if (!shown.has(e.source) || !shown.has(e.target) || edgeIds.has(id)) continue;
      edgeIds.add(id);
      out.push({ group: 'edges', data: { id, source: e.source, target: e.target, type: e.type }, classes: 'e-' + e.type + (e.heuristic ? ' heuristic' : '') });
    }
    return out;
  }

  /** O estilo do grafo com as cores do tema atual (lidas uma vez dos tokens do CSS). */
  function makeStyle() {
    const cs = getComputedStyle(document.body);
    const css = (name) => cs.getPropertyValue(name).trim();
    return [
      // fora da foto do arrasto: transparente, para a imagem de fundo do grafo (overview) aparecer
      { selector: 'core', style: { 'outside-texture-bg-opacity': 0 } },
      { selector: 'node', style: { label: 'data(label)', 'font-size': 10, 'min-zoomed-font-size': 7, color: css('--text'), 'text-valign': 'bottom', 'text-margin-y': 3, width: 14, height: 14, 'background-color': css('--fn'), 'text-max-width': 140, 'text-wrap': 'ellipsis' } },
      { selector: '.k-method', style: { 'background-color': css('--method') } },
      { selector: '.k-class', style: { 'background-color': css('--class'), shape: 'round-rectangle', width: 18, height: 14 } },
      { selector: '.k-selector', style: { 'background-color': css('--muted'), width: 8, height: 8 } },
      { selector: '.k-package', style: { 'background-color': css('--pkg'), shape: 'diamond', width: 22, height: 22, 'font-weight': 600 } },
      { selector: ':parent', style: { 'background-color': css('--file'), 'background-opacity': 1, 'border-color': css('--file-border'), 'border-width': 1, shape: 'round-rectangle', 'text-valign': 'top', 'text-halign': 'center', 'font-size': 11, color: css('--muted'), padding: 10 } },
      { selector: '.k-file:childless', style: { 'background-color': css('--file-border'), shape: 'round-rectangle', width: 16, height: 12 } },
      // events: 'no' nas arestas: nada no mapa reage a clique ou passagem por aresta, e era o teste
      // de "o mouse está em cima de qual aresta?" (a cada movimento, aresta por aresta) que travava
      // o mapa grande parado (~13 ms por movimento no repositório inteiro; sem as arestas, ~2,5 ms).
      // O desenho não muda.
      { selector: 'edge', style: { events: 'no', width: 1.2, 'curve-style': 'bezier', 'target-arrow-shape': 'triangle', 'arrow-scale': 0.7, 'line-color': css('--calls'), 'target-arrow-color': css('--calls'), opacity: 0.75 } },
      { selector: '.e-references', style: { 'line-style': 'dashed', 'line-color': css('--refs'), 'target-arrow-color': css('--refs') } },
      { selector: '.e-imports', style: { 'line-color': css('--imports'), 'target-arrow-color': css('--imports'), opacity: 0.5 } },
      { selector: '.heuristic', style: { 'line-style': 'dashed', 'line-color': css('--heur'), 'target-arrow-color': css('--heur') } },
      { selector: '.k-route', style: { 'background-color': css('--route'), shape: 'tag', width: 26, height: 18, 'font-weight': 700, 'font-size': 11 } },
      { selector: '.k-io-db', style: { 'background-color': css('--db'), shape: 'barrel', width: 20, height: 20, 'font-weight': 600 } },
      { selector: '.k-io-api', style: { 'background-color': css('--api'), shape: 'hexagon', width: 22, height: 20, 'font-weight': 600 } },
      { selector: '.e-route', style: { width: 2, 'line-color': css('--route'), 'target-arrow-color': css('--route') } },
      { selector: '.e-io', style: { width: 2, 'line-color': css('--db'), 'target-arrow-color': css('--db') } },
      { selector: '.chaos-failed', style: { 'border-width': 4, 'border-color': css('--g-bad'), 'background-color': css('--g-bad') } },
      { selector: '.chaos-passed', style: { 'border-width': 3, 'border-color': css('--g-ok') } },
      { selector: '.chaos-invalid', style: { 'border-width': 3, 'border-style': 'dashed', 'border-color': css('--muted') } },
      { selector: '.chaos-target', style: { 'border-width': 4, 'border-color': css('--g-bad') } },
      { selector: '.diff-added', style: { 'border-width': 3, 'border-color': css('--g-ok') } },
      { selector: '.diff-changed', style: { 'border-width': 3, 'border-color': css('--g-warn') } },
      { selector: '.diff-renamed', style: { 'border-width': 3, 'border-style': 'dashed', 'border-color': css('--accent') } },
      { selector: ':parent.diff-top', style: { 'border-width': 2, 'border-color': css('--g-warn') } },
      { selector: ':parent.diff-added', style: { 'border-width': 2, 'border-color': css('--g-ok') } },
      { selector: '.diff-route', style: { 'border-width': 3, 'border-style': 'double', 'border-color': css('--g-warn') } },
      { selector: '.faded', style: { opacity: 0.08 } },
      { selector: '.hl', style: { opacity: 1, 'z-index': 10 } },
      { selector: 'edge.hl', style: { width: 2.4 } },
      { selector: 'node:selected', style: { 'border-width': 3, 'border-color': css('--hl') } },
    ];
  }

  // ---- posições guardadas: o fcose roda uma vez por combinação de filtros; depois é só reaplicar
  const LAYOUT_KEY = 'shieldepy-map-layout:' + $('label').textContent;
  const MAX_LAYOUTS = 6;
  const layouts = (SAVED.layout && typeof SAVED.layout === 'object' ? SAVED.layout : vscodeApi ? null : local.get(LAYOUT_KEY)) || {};
  const signature = () => JSON.stringify([state.group, state.filters]);
  function saveLayout(sig) {
    const positions = {};
    main.nodes().forEach((n) => {
      if (n.isParent()) return;
      const p = n.position();
      positions[n.id()] = [Math.round(p.x), Math.round(p.y)];
    });
    delete layouts[sig];
    layouts[sig] = positions;
    const keys = Object.keys(layouts);
    while (keys.length > MAX_LAYOUTS) delete layouts[keys.shift()];
    if (vscodeApi) vscodeApi.postMessage({ type: 'layout', key: sig, positions });
    else local.set(LAYOUT_KEY, layouts);
  }
  /**
   * Posições para os elementos de agora a partir das guardadas. O código mudou pouco (até 10% de
   * nós novos): os novos entram perto dos vizinhos e o resto não se mexe. Mudou muito: layout novo.
   */
  function reusePositions(els, saved) {
    if (!saved) return null;
    const parents = new Set();
    for (const e of els) if (e.data.parent) parents.add(e.data.parent);
    const pos = {};
    const missing = [];
    let leaves = 0;
    for (const e of els) {
      if (e.group !== 'nodes' || parents.has(e.data.id)) continue;
      leaves++;
      const p = saved[e.data.id];
      if (p) pos[e.data.id] = { x: p[0], y: p[1] };
      else missing.push(e.data);
    }
    if (leaves === 0 || missing.length > leaves * 0.1) return null;
    if (missing.length) placeNear(missing, els, pos);
    return { pos, changed: missing.length > 0 };
  }
  function placeNear(missing, els, pos) {
    const near = new Map();
    const link = (a, b) => { if (!near.has(a)) near.set(a, []); near.get(a).push(b); };
    for (const e of els) if (e.group === 'edges') { link(e.data.source, e.data.target); link(e.data.target, e.data.source); }
    for (const n of missing) if (n.parent) link(n.id, '@' + n.parent);
    const byParent = new Map();
    for (const e of els) if (e.data.parent && pos[e.data.id]) { const l = byParent.get(e.data.parent) || []; l.push(pos[e.data.id]); byParent.set(e.data.parent, l); }
    let maxX = -Infinity, minY = Infinity;
    for (const id in pos) { maxX = Math.max(maxX, pos[id].x); minY = Math.min(minY, pos[id].y); }
    let pending = missing;
    // dois passes: um nó novo ligado só a outro nó novo entra no segundo
    for (let pass = 0; pass < 2 && pending.length; pass++) {
      const left = [];
      for (const n of pending) {
        const pts = [];
        for (const m of near.get(n.id) || []) {
          if (m[0] === '@') pts.push(...(byParent.get(m.slice(1)) || []));
          else if (pos[m]) pts.push(pos[m]);
        }
        if (!pts.length) { left.push(n); continue; }
        let h = 0;
        for (let i = 0; i < n.id.length; i++) h = (h * 31 + n.id.charCodeAt(i)) | 0;
        const angle = ((h >>> 0) % 360) * Math.PI / 180;
        pos[n.id] = { x: pts.reduce((a, p) => a + p.x, 0) / pts.length + 40 * Math.cos(angle), y: pts.reduce((a, p) => a + p.y, 0) / pts.length + 40 * Math.sin(angle) };
      }
      pending = left;
    }
    pending.forEach((n, i) => { pos[n.id] = { x: maxX + 120 + (i % 10) * 40, y: minY + Math.floor(i / 10) * 40 }; });
  }

  const FCOSE = { name: 'fcose', quality: 'default', randomize: true, animate: false, nodeDimensionsIncludeLabels: true, packComponents: true, padding: 30, idealEdgeLength: 70, nodeRepulsion: 6500, nestingFactor: 0.6 };
  // Duas instâncias: o mapa (main) fica vivo enquanto um fluxo aberto (em cima dele) é mostrado,
  // então "Voltar ao mapa" não refaz nada. cy é a que está na tela.
  let main;
  let cy;

  // ---- pulse dos nós com erro (rota que quebrou e operação alvo de achado). Os anéis são
  // elementos HTML com animação CSS por cima do grafo: o Cytoscape só avisa quando redesenhou
  // (pan, zoom, arrasto, realce) e a gente reposiciona os poucos anéis, um quadro por vez.
  const pulseLayer = $('pulses');
  const pulse = { inst: null, nodes: null, raf: 0 };
  function attachPulses(inst) {
    if (pulse.inst && !pulse.inst.destroyed()) pulse.inst.off('render', schedulePulses);
    pulse.inst = inst;
    pulse.nodes = null;
    pulseLayer.textContent = '';
    if (!inst || !CHAOS) return;
    const nodes = inst.nodes('.chaos-failed, .chaos-target');
    if (nodes.empty()) return;
    pulse.nodes = nodes;
    const frag = document.createDocumentFragment();
    nodes.forEach(() => { const el = document.createElement('span'); el.className = 'pulse'; frag.append(el); });
    pulseLayer.append(frag);
    inst.on('render', schedulePulses);
    schedulePulses();
  }
  function schedulePulses() {
    if (!pulse.raf) pulse.raf = requestAnimationFrame(placePulses);
  }
  function placePulses() {
    pulse.raf = 0;
    if (!pulse.nodes || pulse.inst.destroyed()) return;
    const w = pulseLayer.clientWidth;
    const h = pulseLayer.clientHeight;
    const rings = pulseLayer.children;
    pulse.nodes.forEach((n, i) => {
      const el = rings[i];
      const p = n.renderedPosition();
      const size = Math.max(n.renderedOuterWidth(), n.renderedOuterHeight());
      // fora da tela (ou pequeno demais para se ver): sem anel
      const off = size < 3 || p.x < -size || p.y < -size || p.x > w + size || p.y > h + size;
      el.hidden = off;
      if (off) return;
      el.style.width = size + 'px';
      el.style.height = size + 'px';
      el.style.transform = 'translate(' + (p.x - size / 2) + 'px,' + (p.y - size / 2) + 'px)';
      el.classList.toggle('dim', n.hasClass('faded'));
    });
  }

  /**
   * Paredes em volta do grafo: o centro da tela não sai da caixa que contém os nós, então o grafo
   * nunca some da vista; e o zoom para longe para na metade do tamanho que mostra o grafo inteiro.
   * A caixa é medida depois do layout e quando um nó é solto em outro lugar.
   */
  function walls(inst) {
    let box = null;
    let clamping = false;
    const measure = () => {
      const bb = inst.elements().boundingBox();
      box = bb && isFinite(bb.x1) && (bb.w > 0 || bb.h > 0) ? bb : null;
      const w = inst.width();
      const h = inst.height();
      if (!box || !w || !h) return;
      const fit = Math.min(w / (box.w + 60), h / (box.h + 60));
      inst.minZoom(Math.max(0.01, Math.min(fit * 0.5, 1)));
    };
    const clamp = () => {
      const w = inst.width();
      const h = inst.height();
      if (clamping || !box || !w || !h) return;
      const z = inst.zoom();
      const p = inst.pan();
      // o centro da tela, em coordenadas do grafo
      const mx = (w / 2 - p.x) / z;
      const my = (h / 2 - p.y) / z;
      const nx = Math.min(Math.max(mx, box.x1), box.x2);
      const ny = Math.min(Math.max(my, box.y1), box.y2);
      if (nx === mx && ny === my) return;
      clamping = true;
      inst.pan({ x: w / 2 - nx * z, y: h / 2 - ny * z });
      clamping = false;
    };
    measure();
    inst.on('viewport', clamp);
    inst.on('dragfree', measure);
    inst.on('resize', () => { measure(); clamp(); });
  }

  /**
   * Botão do meio arrasta o grafo em qualquer lugar, inclusive em cima de nó ou da caixa de um
   * arquivo (onde o esquerdo pegaria o nó). Escuta na captura, antes do Cytoscape, e durante o
   * gesto marca o arrasto no renderizador para ele usar a imagem pronta do grafo, como no arrasto
   * normal (senão cada quadro redesenharia milhares de elementos).
   */
  function middlePan(container, instOf) {
    container.addEventListener('mousedown', (e) => {
      if (e.button !== 1) return;
      const inst = instOf();
      if (!inst || inst.destroyed()) return;
      e.preventDefault();
      e.stopPropagation();
      const r = inst.renderer();
      const fast = !!(r && r.hoverData && r.textureOnViewport);
      if (fast) r.hoverData.dragging = true;
      container.classList.add('panning');
      let lx = e.clientX;
      let ly = e.clientY;
      const move = (ev) => {
        ev.stopPropagation();
        inst.panBy({ x: ev.clientX - lx, y: ev.clientY - ly });
        lx = ev.clientX;
        ly = ev.clientY;
      };
      const end = (ev) => {
        if (ev && ev.type === 'mouseup' && ev.button !== 1) return;
        if (ev && ev.stopPropagation) ev.stopPropagation();
        window.removeEventListener('mousemove', move, true);
        window.removeEventListener('mouseup', end, true);
        window.removeEventListener('blur', end);
        container.classList.remove('panning');
        if (fast && !inst.destroyed()) { r.hoverData.dragging = false; inst.forceRender(); }
      };
      window.addEventListener('mousemove', move, true);
      window.addEventListener('mouseup', end, true);
      window.addEventListener('blur', end);
    }, true);
    // sem a rolagem automática do botão do meio (Windows) e sem colar no Linux
    container.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });
  }
  middlePan($('cy'), () => main);
  middlePan($('flow'), () => cy);

  /**
   * As bordas do arrasto. No mapa grande, ao arrastar ou dar zoom, o Cytoscape mostra uma foto do
   * que estava na tela (redesenhar milhares de elementos por quadro é lento demais), e fora dela
   * ficava o vazio. Aqui fica uma imagem do grafo inteiro, em coordenadas do mapa, que se preenche
   * copiando a tela já desenhada sempre que o grafo para (~1 ms, sem redesenhar nada); a abertura
   * mostra o grafo inteiro, então ela já nasce completa. Durante o gesto, depois de cada quadro da
   * foto, ela é desenhada no próprio canvas do Cytoscape, atrás do que ele desenhou e só fora da
   * área da foto: uma cópia de imagem por quadro (no navegador, na placa de vídeo). Um elemento
   * HTML recortado por cima custava caro no zoom (o recorte era refeito a cada quadro). Ao soltar,
   * o Cytoscape desenha tudo em qualidade cheia. Mudou o desenho (realce, tema, nó arrastado): ela
   * é zerada e volta a se preencher.
   */
  const OVERVIEW_MAX = 2560;
  function overview(inst) {
    const r = inst.renderer();
    if (!r || !r.textureOnViewport || !r.data || !r.data.canvases || !r.data.contexts) return null;
    const bb = inst.elements().boundingBox();
    if (!bb || !isFinite(bb.x1) || bb.w <= 0 || bb.h <= 0) return null;
    const box = { x1: bb.x1 - 40, y1: bb.y1 - 40, w: bb.w + 80, h: bb.h + 80 };
    const s = Math.min(OVERVIEW_MAX / box.w, OVERVIEW_MAX / box.h, 4);
    const el = document.createElement('canvas');
    el.width = Math.ceil(box.w * s);
    el.height = Math.ceil(box.h * s);
    const ctx = el.getContext('2d');
    let timer = 0;
    const copy = () => {
      timer = 0;
      if (inst.destroyed() || r.textureDrawLastFrame) return;
      const z = inst.zoom();
      const p = inst.pan();
      const w = inst.width();
      const h = inst.height();
      if (!w || !h) return;
      const dx = (-p.x / z - box.x1) * s;
      const dy = (-p.y / z - box.y1) * s;
      const dw = (w / z) * s;
      const dh = (h / z) * s;
      ctx.clearRect(dx, dy, dw, dh);
      ctx.drawImage(r.data.canvases[r.NODE], dx, dy, dw, dh);
      ctx.drawImage(r.data.canvases[r.DRAG], dx, dy, dw, dh);
    };
    const onRender = () => {
      const v = r.textureDrawLastFrame && r.textureCache && r.textureCache.viewport;
      if (v) {
        // mesma transformação que o Cytoscape usa para colar a foto (coordenadas do mapa)
        const c = r.data.contexts[r.NODE];
        const pr = r.getPixelRatio();
        const z = inst.zoom();
        const p = inst.pan();
        c.save();
        c.setTransform(z * pr, 0, 0, z * pr, p.x * pr, p.y * pr);
        // só fora da foto: o retângulo do grafo menos o retângulo da foto
        c.beginPath();
        c.rect(box.x1, box.y1, box.w, box.h);
        c.rect(v.mpan.x, v.mpan.y, v.width / pr / v.zoom, v.height / pr / v.zoom);
        c.clip('evenodd');
        c.globalCompositeOperation = 'destination-over';
        c.drawImage(el, box.x1, box.y1, box.w, box.h);
        c.restore();
      } else {
        clearTimeout(timer);
        timer = setTimeout(copy, 120);
      }
    };
    inst.on('render', onRender);
    inst.on('dragfree', () => ctx.clearRect(0, 0, el.width, el.height));
    return {
      clear() { ctx.clearRect(0, 0, el.width, el.height); },
      destroy() { clearTimeout(timer); el.width = 0; el.height = 0; },
    };
  }
  const overviewOf = (inst) => (inst && !inst.destroyed() ? inst.scratch('_overview') : null);

  function create(container, els, layout) {
    // Sem os elementos no construtor: com eles, o Cytoscape roda um layout padrão que o fcose
    // joga fora logo depois.
    // Mapa grande: ao arrastar ou dar zoom, o Cytoscape move uma imagem do grafo pronta em vez de
    // redesenhar milhares de elementos a cada quadro; parado, o desenho é o mesmo.
    const inst = cytoscape({ container, style: makeStyle(), minZoom: 0.05, textureOnViewport: els.length > 2000 });
    inst.add(els);
    inst.layout(layout).run();
    walls(inst);
    inst.scratch('_overview', overview(inst));
    inst.on('tap', 'node', (ev) => select(ev.target));
    inst.on('tap', (ev) => { if (ev.target === inst) { inst.elements().unselect(); clearHighlight(); } });
    return inst;
  }
  function destroy(inst) {
    const ov = overviewOf(inst);
    if (ov) ov.destroy();
    inst.destroy();
  }
  function closeFlow() {
    if (cy && cy !== main) destroy(cy);
    cy = main;
    $('flow').hidden = true;
    $('flowbar').hidden = true;
    if (main) main.resize();
    if (pulse.inst !== cy) attachPulses(cy);
  }
  function build() {
    closeFlow();
    if (main) destroy(main);
    $('details').hidden = true;
    const els = elements();
    const sig = signature();
    const reuse = reusePositions(els, layouts[sig]);
    if (reuse) {
      main = create($('cy'), els, { name: 'preset', positions: (n) => reuse.pos[n.id()], fit: true, padding: 30, animate: false });
      cy = main;
      if (reuse.changed) saveLayout(sig);
    } else {
      main = create($('cy'), els, Object.assign({}, FCOSE, { quality: els.length > 6000 ? 'draft' : 'default' }));
      cy = main;
      saveLayout(sig);
    }
    attachPulses(cy);
    setActiveTile(null);
  }

  /**
   * Modo fluxo: só a cadeia escolhida, em camadas a partir da raiz, sem as caixas de agrupamento.
   * Arquivo continua quando é ponta de aresta (o módulo de rotas é quem registra os handlers).
   */
  function showFlow(collection, root, title) {
    const els = collection.map((el) => {
      const data = Object.assign({}, el.data());
      delete data.parent;
      return { group: el.isEdge() ? 'edges' : 'nodes', data, classes: el.classes().filter((c) => c !== 'faded' && c !== 'hl').join(' ') };
    });
    const rootId = root.id();
    if (cy && cy !== main) destroy(cy);
    $('flowbar').hidden = false;
    $('flow').hidden = false;
    $('details').hidden = true;
    cy = create($('flow'), els, { name: 'breadthfirst', directed: true, roots: (n) => n.id() === rootId, spacingFactor: 1.15, animate: false, nodeDimensionsIncludeLabels: true, padding: 40 });
    $('flowtitle').textContent = title;
    attachPulses(cy);
    setActiveTile(null);
  }
  $('back').onclick = () => { closeFlow(); $('details').hidden = true; };

  // ---- seleção e cadeias
  const FLOW_TYPES = new Set(['calls', 'references', 'route', 'io']);
  const flowEdges = (eles) => eles.filter((e) => e.isEdge() && FLOW_TYPES.has(e.data('type')));
  function highlight(collection) {
    const inst = collection.cy();
    // em lote: num mapa grande são milhares de elementos, e fora do lote cada um redesenha
    inst.batch(() => {
      inst.elements().addClass('faded').removeClass('hl');
      collection.removeClass('faded').addClass('hl');
      collection.parents().removeClass('faded');
    });
    inst.scratch('_hl', true);
    const ov = overviewOf(inst);
    if (ov) ov.clear();
  }
  function clearHighlight() {
    if (cy && cy.scratch('_hl')) { cy.batch(() => cy.elements().removeClass('faded hl')); const ov = overviewOf(cy); if (ov) ov.clear(); }
    if (cy) cy.scratch('_hl', false);
    $('details').hidden = true;
    setActiveTile(null);
  }

  // ---- cartões do caos como filtro: clicar em "achados" apaga o resto do grafo e deixa só os
  // nós daquele grupo; clicar de novo (ou no fundo do grafo) volta tudo.
  const tileFilter = { active: null, nodes: {} };
  function setActiveTile(key) {
    tileFilter.active = key;
    const tiles = document.querySelector('#chaos .tiles');
    if (!tiles) return;
    tiles.classList.toggle('filtering', !!key);
    for (const b of tiles.querySelectorAll('button[data-tile]')) b.setAttribute('aria-pressed', String(b.dataset.tile === key));
  }
  function filterByTile(key) {
    if (tileFilter.active === key) { clearHighlight(); return; }
    if (!state.filters.routes) { state.filters.routes = true; const box = document.querySelector('[data-filter=routes]'); if (box) box.checked = true; build(); }
    closeFlow();
    main.elements().unselect();
    const sel = tileFilter.nodes[key];
    let col = main.collection();
    for (const id of sel.routes) col = col.union(main.getElementById(routeId({ id })));
    if (sel.targets) col = col.union(main.nodes('.chaos-target'));
    if (col.empty()) return;
    highlight(col);
    $('details').hidden = true;
    setActiveTile(key);
    // enquadra o grupo, sem passar do zoom de leitura (com um nó só, o fit encheria a tela)
    const bb = col.boundingBox();
    const zoom = Math.min(1.4, (main.width() - 160) / Math.max(bb.w, 1), (main.height() - 160) / Math.max(bb.h, 1));
    main.animate({ center: { eles: col }, zoom: Math.max(zoom, main.minZoom()) }, { duration: 300 });
  }
  function chain(node, dir) {
    let frontier = node.collection();
    let all = node.collection();
    for (let depth = 0; depth < 50 && frontier.length > 0; depth++) {
      const edges = flowEdges(dir === 'down' ? frontier.connectedEdges().filter((e) => frontier.contains(e.source())) : frontier.connectedEdges().filter((e) => frontier.contains(e.target())));
      const next = (dir === 'down' ? edges.targets() : edges.sources()).difference(all);
      all = all.union(edges).union(next);
      frontier = next;
    }
    return all;
  }
  const KIND = { function: 'Função', method: 'Método', class: 'Classe', selector: 'Seletor', file: 'Arquivo', package: 'Pacote', route: 'Rota', 'io-db': 'Operação de banco', 'io-api': 'Chamada de API externa' };
  function select(node) {
    const raw = node.data('raw');
    node.cy().elements().unselect();
    node.select();
    highlight(node.closedNeighborhood().union(node.descendants()));
    setActiveTile(null);
    const rows = [];
    if (raw.route) {
      const r = raw.route;
      rows.push(['registro', r.file + ':' + (r.line + 1)], ['handlers', r.handlers.map((h) => h.label).join(' → ')]);
      rows.push(['operações', r.operations.map((o) => o.order + '. ' + o.kind + ' ' + o.target).join('; ') || '—']);
      rows.push(['tags', r.tags.map((t) => t.tag + (t.targets ? '(' + t.targets.join(',') + ')' : '')).join(', ') || '—']);
      rows.push(['confiança', r.confidence + (r.truncated ? ' (percurso truncado)' : '')]);
    }
    if (raw.op) {
      rows.push(['via', raw.op.via + (raw.op.operation ? ', ' + raw.op.operation : '')]);
      if (raw.op.timeout) rows.push(['timeout', raw.op.timeout]);
      if (raw.op.lock) rows.push(['trava', 'FOR UPDATE']);
    }
    if (diffSets.renamedFrom.has(raw.id)) rows.push(['renomeado de', diffSets.renamedFrom.get(raw.id)]);
    if (raw.kind === 'route' && touchedRoutes.has(raw.name)) rows.push(['tocada pelo PR', touchedRoutes.get(raw.name).join('; ')]);
    if (raw.file) rows.push(['arquivo', raw.file]);
    if (raw.startLine !== undefined) rows.push(['linhas', (raw.startLine + 1) + '–' + (raw.endLine + 1)]);
    if (raw.container) rows.push(['contêiner', raw.container]);
    if (raw.signature) rows.push(['assinatura', raw.signature]);
    if (raw.returns && raw.returns.length) rows.push(['retorna', raw.returns.join('.')]);
    if (raw.extends) rows.push(['extends', raw.extends.join('.')]);
    if (raw.implements) rows.push(['implements', raw.implements.join(', ')]);
    rows.push(['sai / chega', flowEdges(node.outgoers()).length + ' / ' + flowEdges(node.incomers()).length]);
    const el = $('details');
    el.hidden = false;
    el.innerHTML = '<div class="card-head"><div><h2>' + escape(raw.name) + '</h2><span class="kind">' + escape(KIND[raw.kind] || raw.kind) + '</span></div><button class="icon-btn" id="clear" type="button" aria-label="Limpar a seleção" title="Limpar a seleção">×</button></div>' +
      '<dl>' + rows.map(([k, v]) => '<dt>' + k + '</dt><dd>' + escape(String(v)) + '</dd>').join('') + '</dl>' +
      '<div class="actions"><button class="btn" id="down" type="button">Cadeia abaixo</button><button class="btn" id="up" type="button">Quem chega aqui</button>' +
      (vscodeApi && (raw.file || raw.kind === 'file' || raw.route) ? '<button class="btn primary" id="open" type="button">Abrir código</button>' : '') + '</div>';
    $('down').onclick = () => showFlow(chain(node, 'down'), node, 'Cadeia a partir de ' + raw.name);
    $('up').onclick = () => showFlow(chain(node, 'up'), node, 'Quem chega em ' + raw.name);
    $('clear').onclick = () => { cy.elements().unselect(); clearHighlight(); };
    const open = $('open');
    // rota abre onde ela é registrada
    if (open && raw.route) open.onclick = () => vscodeApi.postMessage({ type: 'open', file: raw.route.file, line: raw.route.line });
    else if (open) open.onclick = () => vscodeApi.postMessage({ type: 'open', file: raw.kind === 'file' ? raw.id : raw.file, line: raw.startLine || 0 });
    el.scrollIntoView({ block: 'nearest' });
  }
  function escape(t) {
    return t.split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;');
  }
  function focus(id) {
    const node = main.getElementById(id);
    if (node.empty()) return false;
    closeFlow();
    main.animate({ center: { eles: node }, zoom: Math.max(main.zoom(), 1.2) }, { duration: 250 });
    select(node);
    return true;
  }

  // ---- busca e filtros
  const hint = $('searchHint');
  $('search').addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') { ev.target.value = ''; hint.hidden = true; clearHighlight(); return; }
    if (ev.key !== 'Enter') return;
    const q = ev.target.value.trim().toLowerCase();
    hint.hidden = !q;
    if (!q) return clearHighlight();
    // busca no mapa inteiro (com um fluxo aberto, o foco volta ao mapa)
    const hit = main.nodes().filter((n) => n.data('label').toLowerCase().includes(q) || n.id().toLowerCase().includes(q));
    hint.textContent = hit.empty() ? 'Nada no mapa com esse nome.' : hit.length === 1 ? '1 resultado.' : plural(hit.length, 'resultado', 'resultados') + ', todos destacados.';
    if (hit.empty()) return;
    focus(hit[0].id());
    if (hit.length > 1) highlight(hit);
  });
  $('search').addEventListener('input', (ev) => { if (!ev.target.value) { hint.hidden = true; clearHighlight(); } });
  for (const box of document.querySelectorAll('[data-filter]')) {
    box.addEventListener('change', () => { state.filters[box.dataset.filter] = box.checked; build(); });
  }
  $('group').addEventListener('change', (ev) => { state.group = ev.target.checked; build(); });

  // ---- listas do painel: uma linha clicável (título, detalhe e o sinal de ir)
  function row(title, sub, onclick, shape) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'row-btn';
    b.innerHTML = (shape ? '<span class="shape ' + shape + '"></span>' : '') + '<span class="row-main"><span class="row-title"></span><span class="row-sub"></span></span><span class="chevron"></span>';
    b.querySelector('.row-title').append(...(Array.isArray(title) ? title : [title]));
    if (sub) b.querySelector('.row-sub').textContent = sub;
    else b.querySelector('.row-sub').remove();
    b.onclick = onclick;
    return b;
  }
  function routeTitle(id) {
    const space = id.indexOf(' ');
    if (space < 0) return [id];
    const m = document.createElement('span');
    m.className = 'method';
    m.textContent = id.slice(0, space);
    return [m, id.slice(space + 1)];
  }
  function fold(title, count, body, open) {
    const d = document.createElement('details');
    d.className = 'fold';
    d.open = !!open;
    d.innerHTML = '<summary><span class="chevron"></span><span></span><span class="count"></span></summary>';
    d.querySelector('summary span:nth-child(2)').textContent = title;
    d.querySelector('.count').textContent = fmt(count);
    d.appendChild(body);
    return d;
  }
  function group(children) {
    const g = document.createElement('div');
    g.className = 'group';
    g.append(...children);
    return g;
  }

  const weak = $('weak');
  if (SYSTEM.weakSpots.length === 0) {
    weak.innerHTML = '<div class="sec-head"><h2>Pontos fracos</h2></div><p class="note">Nenhum: todas as chamadas internas foram provadas.</p>';
  } else {
    const items = SYSTEM.weakSpots.map((w) => {
      const slash = w.file.lastIndexOf('/');
      const parts = [];
      if (w.callsUnresolved) parts.push(plural(w.callsUnresolved, 'sem alvo', 'sem alvo'));
      if (w.callsHeuristic) parts.push(plural(w.callsHeuristic, 'só pelo nome', 'só pelo nome'));
      if (w.importsUnresolved.length) parts.push('imports: ' + w.importsUnresolved.join(', '));
      const b = row(w.file.slice(slash + 1), (slash > 0 ? w.file.slice(0, slash) + '; ' : '') + parts.join(', '), () => {
        if (!focus(w.file)) {
          state.group = true; $('group').checked = true;
          if (isTest(w.file)) { state.filters.tests = true; document.querySelector('[data-filter=tests]').checked = true; }
          build(); focus(w.file);
        }
      }, w.callsUnresolved ? 'bad' : 'warn');
      b.title = w.file;
      return b;
    });
    weak.append(fold('Pontos fracos', SYSTEM.weakSpots.length, group(items), SYSTEM.weakSpots.length <= 5));
    const note = document.createElement('p');
    note.className = 'note';
    note.textContent = 'Arquivos onde o mapa ainda adivinha uma chamada ou não acha o alvo.';
    weak.append(note);
  }

  // ---- lista de rotas (com topologia): cada uma abre o fluxo rota → handlers → ... → I/O
  if (TOPOLOGY) {
    const list = $('routes');
    list.hidden = false;
    if (TOPOLOGY.routes.length === 0) {
      list.innerHTML = '<div class="sec-head"><h2>Rotas</h2><span class="count">0</span></div><p class="note">Nenhuma rota Express ou Fastify encontrada.</p>';
    } else {
      const items = TOPOLOGY.routes.map((r) => {
        const ops = plural(r.operations.length, 'operação', 'operações');
        return row(routeTitle(r.id), ops + (r.tags.length ? ', ' + r.tags.map((t) => t.tag).join(', ') : ''), () => {
          if (!state.filters.routes) { state.filters.routes = true; document.querySelector('[data-filter=routes]').checked = true; build(); }
          const node = main.getElementById(routeId(r));
          if (!node.empty()) showFlow(chain(node, 'down'), node, r.id);
        }, chaosShape(routeChaos.get(r.id)));
      });
      list.append(fold('Rotas', TOPOLOGY.routes.length, group(items), TOPOLOGY.routes.length <= 8));
    }
  }

  // ---- seção "Caos" (V2): o resultado do último shieldepy chaos sobre o mapa
  function openRoute(id, title) {
    if (!state.filters.routes) { state.filters.routes = true; const box = document.querySelector('[data-filter=routes]'); if (box) box.checked = true; build(); }
    const node = main.getElementById(routeId({ id }));
    if (!node.empty()) showFlow(chain(node, 'down'), node, title || id);
  }
  /** Agrupa por motivo: doze testes que não carregaram pelo mesmo erro viram um bloco só. */
  function byReason(items, reasonOf, label) {
    const groups = new Map();
    for (const it of items) { const k = reasonOf(it) || 'sem motivo registrado'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(it); }
    const stack = document.createElement('div');
    stack.className = 'stack';
    for (const [reason, list] of groups) {
      const head = document.createElement('div');
      head.className = 'reason';
      head.innerHTML = '<b></b> ';
      head.querySelector('b').textContent = plural(list.length, 'teste', 'testes') + ':';
      head.append(reason);
      stack.append(group([head].concat(list.map((it) => row(routeTitle(it.routeId), label(it), () => openRoute(it.routeId, it.routeId + ', ' + it.failure))))));
    }
    return stack;
  }
  if (CHAOS) {
    const sec = $('chaos');
    sec.hidden = false;
    const failed = CHAOS.outcomes.filter((o) => o.status === 'failed');
    const passed = CHAOS.outcomes.filter((o) => o.status === 'passed');
    // não se aplica (0035): a falha não disparou, com o controle verde; não conta como inválido
    const notApplicable = CHAOS.outcomes.filter((o) => o.notApplicable);
    const invalid = CHAOS.outcomes.filter((o) => o.status === 'invalid' && !o.notApplicable);
    const stale = typeof CHAOS.stale === 'boolean' ? CHAOS.stale : !!TOPOLOGY && CHAOS.topologyHash !== TOPOLOGY.contentHash;
    let html = '<div class="sec-head"><h2>Caos</h2><span class="sec-meta">' + escape(CHAOS.project) + '</span></div>';
    if (stale) html += '<div class="banner warn">Este resultado é de outra versão do mapa. Rode o <code>shieldepy chaos</code> de novo.</div>';
    if (CHAOS.runError) html += '<div class="banner warn">Os testes não rodaram (erro de ambiente): ' + escape(CHAOS.runError.split('\n')[0]) + '</div>';
    else if (!CHAOS.ran) html += '<div class="banner warn">Testes gerados, mas não executados (<code>--no-run</code>).</div>';
    else if (CHAOS.hits > 0) html += '<div class="banner bad"><b>Bloqueado:</b> ' + CHAOS.hits + ' achado(s)' + (CHAOS.failOn === 'Baixo' ? '' : ' com severidade ' + escape(CHAOS.failOn) + ' ou pior') + '.</div>';
    else if (CHAOS.scope && CHAOS.scope.tested.length === 0) html += '<div class="banner ok">Nenhuma rota sensível tocada pelo PR.</div>';
    // nenhum teste valeu: não dá para dizer que o código aguentou
    else if (!failed.length && !passed.length && invalid.length) html += '<div class="banner warn">Nenhum teste valeu: ' + (invalid.length === 1 ? 'o único foi inválido' : 'os ' + invalid.length + ' foram inválidos') + '. O motivo está logo abaixo.</div>';
    else html += '<div class="banner ok">O código aguentou ' + (failed.length ? 'o portão (' + failed.length + ' achado(s) abaixo dele)' : 'todas as falhas injetadas') + '.</div>';
    // cada cartão é um botão que filtra o grafo pelas rotas daquele grupo (sem rota no mapa: desligado)
    const routesOf = (list) => [...new Set(list.map((o) => o.routeId))];
    tileFilter.nodes = {
      failed: { routes: routesOf(failed), targets: true },
      passed: { routes: routesOf(passed) },
      invalid: { routes: routesOf(invalid) },
      untested: { routes: routesOf(CHAOS.untested) },
      notApplicable: { routes: routesOf(notApplicable) },
    };
    const onMap = (key) => !!TOPOLOGY && tileFilter.nodes[key].routes.some((id) => TOPOLOGY.routes.some((r) => r.id === id));
    const tile = (key, n, one, many, tone) => {
      const label = n === 1 ? one : many;
      const can = n > 0 && onMap(key);
      return '<button type="button" class="tile' + (n && tone ? ' ' + tone : '') + '" data-tile="' + key + '" aria-pressed="false"' + (can ? ' title="Mostrar só ' + label + ' no grafo"' : ' disabled') + '><b>' + fmt(n) + '</b><span>' + label + '</span></button>';
    };
    html += '<div class="tiles four">' + tile('failed', failed.length, 'achado', 'achados', 'bad') + tile('passed', passed.length, 'aguentou', 'aguentaram', 'ok') + tile('invalid', invalid.length, 'inválido', 'inválidos') + tile('untested', CHAOS.untested.length, 'sem teste', 'sem teste') + (notApplicable.length ? tile('notApplicable', notApplicable.length, 'não se aplica', 'não se aplicam') : '') + '</div>';
    if (CHAOS.scope) html += '<p class="note">Escopo: ' + (CHAOS.scope.all ? 'todas as rotas (' + escape(CHAOS.scope.all) + ')' : CHAOS.scope.tested.length + ' rota(s) tocada(s) desde ' + escape(CHAOS.scope.base)) + '</p>';
    sec.innerHTML = html;
    for (const b of sec.querySelectorAll('button[data-tile]')) b.onclick = () => filterByTile(b.dataset.tile);
    for (const o of failed) {
      const card = document.createElement('div');
      card.className = 'finding' + (o.severity === 'Crítico' ? '' : ' alto');
      const b = row([], o.failure + ' em ' + o.target + ', ' + (o.durationMs / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' s' + (o.message ? '. ' + o.message : ''), () => openRoute(o.routeId, o.routeId + ', ' + o.failure + ' em ' + o.target));
      const sev = document.createElement('span');
      sev.className = 'sev';
      sev.textContent = o.severity || '';
      b.querySelector('.row-title').append(sev, ...routeTitle(o.routeId));
      const code = document.createElement('code');
      code.textContent = o.testFile.slice(o.testFile.lastIndexOf('/') + 1);
      code.title = o.testFile;
      b.querySelector('.row-main').append(code);
      card.append(b);
      if (vscodeApi) {
        const actions = document.createElement('div');
        actions.className = 'actions';
        const t = document.createElement('button');
        t.type = 'button';
        t.className = 'btn';
        t.textContent = 'Abrir teste';
        t.onclick = () => vscodeApi.postMessage({ type: 'openTest', file: o.testFile });
        actions.append(t);
        card.append(actions);
      }
      sec.append(card);
    }
    if (passed.length) sec.append(fold('Aguentaram', passed.length, group(passed.map((o) => row(routeTitle(o.routeId), o.failure + ' em ' + o.target, () => openRoute(o.routeId, o.routeId + ', ' + o.failure), 'ok'))), false));
    if (invalid.length) sec.append(fold('Inválidos (não contam no portão)', invalid.length, byReason(invalid, (o) => o.message, (o) => o.failure + ' em ' + o.target), invalid.length <= 3 || (!failed.length && !passed.length)));
    if (notApplicable.length) sec.append(fold('Não se aplica (a falha não disparou; não contam no portão)', notApplicable.length, byReason(notApplicable, (o) => o.message, (o) => o.failure + ' em ' + o.target), false));
    if (CHAOS.untested.length) sec.append(fold('Sem teste nesta execução', CHAOS.untested.length, byReason(CHAOS.untested, (u) => u.reason, (u) => u.failure + ' em ' + u.target), false));
    const legend = document.createElement('p');
    legend.className = 'note';
    legend.textContent = 'No mapa: rota vermelha (pulsando) quebrou, borda verde aguentou, borda tracejada: nenhum teste valeu; operação com borda vermelha (pulsando) é o alvo de um achado. Os números acima filtram o grafo.';
    sec.append(legend);
  }

  // ---- seção "Mudanças do PR" (V2)
  if (DIFF) {
    const d = DIFF.diff;
    const sec = $('diff');
    sec.hidden = false;
    let html = '<div class="sec-head"><h2>Mudanças do PR</h2><span class="sec-meta">desde ' + escape(DIFF.base) + ' (' + escape(DIFF.commit.slice(0, 10)) + ')</span></div>';
    if (d.empty) html += '<div class="banner ok">Nenhuma mudança de estrutura: só comentário, espaço ou linhas deslocadas.</div>';
    const tile = (n, one, many, tone) => '<div class="tile' + (n && tone ? ' ' + tone : '') + '"><b>' + fmt(n) + '</b><span>' + (n === 1 ? one : many) + '</span></div>';
    html += '<div class="tiles four">' + tile(d.symbols.added.length, 'novo', 'novos', 'ok') + tile(d.symbols.changed.length, 'alterado', 'alterados') + tile(d.symbols.renamed.length, 'renomeado', 'renomeados') + tile(d.symbols.removed.length, 'removido', 'removidos') + '</div>';
    sec.innerHTML = html;
    const jump = (id) => {
      if (!focus(id)) { state.filters.changed = false; const box = document.querySelector('[data-filter=changed]'); if (box) box.checked = false; build(); focus(id); }
    };
    const block = (title, items, shape) => {
      if (items.length === 0) return;
      const shown = items.slice(0, 30).map((it) => {
        if (!it.id) { const p = document.createElement('div'); p.className = 'reason'; p.textContent = it.text; return p; }
        return row(it.route ? routeTitle(it.id) : it.text, it.sub || '', () => (it.route ? openRoute(it.id, it.id + ', tocada pelo PR') : jump(it.id)), shape);
      });
      if (items.length > 30) { const more = document.createElement('div'); more.className = 'reason'; more.textContent = 'e mais ' + fmt(items.length - 30); shown.push(more); }
      sec.append(fold(title, items.length, group(shown), items.length <= 8));
    };
    if (routesInfo) block(routesInfo.all ? 'Rotas tocadas: todas (' + routesInfo.all + ')' : 'Rotas tocadas', routesInfo.all ? [] : routesInfo.affected.map((a) => ({ id: a.id, route: true, sub: a.why.join('; ') })));
    block('Corpo alterado', d.symbols.changed.map((id) => ({ id, text: id })), 'warn');
    block('Novos', d.symbols.added.map((id) => ({ id, text: id })), 'ok');
    block('Renomeados', d.symbols.renamed.map((r) => ({ id: r.to, text: r.to, sub: 'era ' + r.from })));
    block('Código de topo alterado', d.files.topChanged.map((id) => ({ id, text: id })), 'warn');
    block('Arquivos novos', d.files.added.map((id) => ({ id, text: id })), 'ok');
    block('Removidos (não estão mais no mapa)', d.symbols.removed.concat(d.files.removed).map((id) => ({ text: '− ' + id })));
    const legend = document.createElement('p');
    legend.className = 'note';
    legend.textContent = 'No mapa: borda verde é novo, âmbar é corpo alterado, azul tracejada é renomeado; rota com borda dupla âmbar foi tocada pelo PR.';
    sec.append(legend);
  }

  // #mudancas abre direto no filtro "só o que o PR mudou" (link do artefato do CI). Em mapa grande
  // (V2e: acima de ~3 mil nós o layout leva vários segundos e o todo não se lê), o diff já abre filtrado.
  if (DIFF && (location.hash === '#mudancas' || (SYSTEM.nodes.length > 3000 && !DIFF.diff.empty))) {
    state.filters.changed = true;
    const box = document.querySelector('[data-filter=changed]');
    if (box) box.checked = true;
  }

  function start() {
    applyTheme();
    build();
    $('loading').hidden = true;

    // link direto: #foco=<id> seleciona um nó; #fluxo=<id> abre a cadeia a partir dele; #rota=POST /x abre a rota; #mudancas filtra o diff
    const hash = decodeURIComponent(location.hash.slice(1));
    const [mode, target] = [hash.slice(0, hash.indexOf('=')), hash.slice(hash.indexOf('=') + 1)];
    if (mode === 'rota' && TOPOLOGY) {
      const node = main.getElementById('route:' + target);
      if (!node.empty()) showFlow(chain(node, 'down'), node, target);
    }
    if (target && (mode === 'foco' || mode === 'fluxo')) {
      const node = main.nodes().filter((n) => n.id() === target || n.id().startsWith(target + ':'))[0];
      if (node && mode === 'foco') focus(node.id());
      if (node && mode === 'fluxo') showFlow(chain(node, 'down'), node, 'Cadeia a partir de ' + node.data('raw').name);
    }
  }
  // o painel e o "Montando o mapa…" aparecem antes do layout (que trava a página enquanto roda);
  // o setTimeout cobre o webview escondido, onde o requestAnimationFrame não dispara
  applyTheme();
  let started = false;
  const kick = () => { if (!started) { started = true; start(); } };
  requestAnimationFrame(() => setTimeout(kick, 0));
  setTimeout(kick, 80);
})();
`;

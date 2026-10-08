// Visualizador do mapa do sistema (Cytoscape.js + layout fcose). Dois modos:
//   - `inline`: HTML autocontido, bibliotecas e dados embutidos — a CLI grava e abre offline;
//   - `webview`: a extensão do VS Code serve as bibliotecas como recursos do webview, com CSP
//     por nonce (nada inline sem nonce), e ganha o botão "Abrir código" (postMessage → editor).
// É a ferramenta de CONFERÊNCIA do mapeamento (E1). O visualizador "de produto" (topologia e
// resultados do caos) vem depois — ver PLANO-CHAOS.md.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { SystemGraph, TopologyGraph } from '@shieldepy/core';
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

export type ViewerMode =
  | { kind: 'inline' }
  | {
      kind: 'webview';
      /** URIs (asWebviewUri) das bibliotecas, na ordem de VIEWER_LIBRARIES. */
      libraryUris: string[];
      nonce: string;
      cspSource: string;
    };

/** JSON seguro dentro de <script>: `<` vira `<` (no JSON, `<` só aparece dentro de strings). */
function embedJson(value: unknown): string {
  return JSON.stringify(value).split('<').join('\u003c');
}

function escapeHtml(text: string): string {
  return text.split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;').split('"').join('&quot;');
}

/**
 * Com `topology`, o mapa ganha as rotas e as operações de I/O como nós (rota → handlers → ... →
 * `db_write stock`) e uma lista de rotas que abre o fluxo de cada uma.
 */
export function renderGraphHtml(system: SystemGraph, label: string, mode: ViewerMode = { kind: 'inline' }, topology?: TopologyGraph): string {
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

  return `<!doctype html>
<html lang="pt-BR">
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
<aside id="side">
  <header>
    <h1>Mapa do sistema</h1>
    <p class="muted" id="label">${escapeHtml(label)}</p>
  </header>
  <section id="coverage"></section>
  <section>
    <input id="search" type="search" placeholder="Buscar símbolo ou arquivo (Enter)" autocomplete="off">
  </section>
  <section class="filters">
    <h2>Mostrar</h2>
    ${topology ? '<label><input type="checkbox" data-filter="routes" checked> <span class="sw route"></span> rotas e operações de I/O</label>' : ''}
    <label><input type="checkbox" data-filter="calls" checked> <span class="sw calls"></span> chamadas</label>
    <label><input type="checkbox" data-filter="references" checked> <span class="sw references"></span> referências (handler passado como valor)</label>
    <label><input type="checkbox" data-filter="imports"> <span class="sw imports"></span> imports entre arquivos</label>
    <label><input type="checkbox" data-filter="packages" checked> pacotes externos</label>
    <label><input type="checkbox" data-filter="tests"> arquivos de teste</label>
    <label><input type="checkbox" data-filter="isolated"> símbolos sem ligação</label>
    <label><input type="checkbox" id="group" checked> agrupar símbolos por arquivo</label>
    <p class="muted small"><span class="sw heuristic"></span> chamada ligada só por nome (heurística)</p>
  </section>
  <section id="details" hidden></section>
  <section id="routes" hidden></section>
  <section id="weak"></section>
  <footer class="muted small">hash <code id="hash"></code></footer>
</aside>
<main id="stage">
  <div id="flowbar" hidden><span id="flowtitle"></span><button id="back">Voltar ao mapa</button></div>
  <div id="cy" aria-label="Grafo do sistema"></div>
</main>
${libraries}
<script${nonce}>const SYSTEM = ${embedJson(system)}; const TOPOLOGY = ${embedJson(topology ?? null)};</script>
<script${nonce}>${APP}</script>
</body>
</html>
`;
}

const STYLE = `
:root {
  --bg: #f7f7f5; --panel: #ffffff; --text: #1d1d1f; --muted: #6b6b70; --line: #e3e3e0;
  --file: #eef2f7; --file-border: #c9d3e0; --fn: #2f6fdf; --method: #7a4fd1; --class: #0f8a6a;
  --pkg: #b5651d; --calls: #4a5568; --refs: #2f6fdf; --imports: #b9bcc4; --heur: #e0861a;
  --hl: #e5484d; --accent: #2f6fdf; --route: #c2255c; --db: #0b7285; --api: #d9480f;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #141416; --panel: #1c1c1f; --text: #ececee; --muted: #9a9aa2; --line: #2c2c31;
    --file: #22262e; --file-border: #3a4150; --fn: #6aa0ff; --method: #b294ff; --class: #3fcf9f;
    --pkg: #e3a15c; --calls: #a0a7b4; --refs: #6aa0ff; --imports: #4a4e57; --heur: #f0a040;
    --hl: #ff6b6f; --accent: #6aa0ff; --route: #f06595; --db: #3bc9db; --api: #ff922b;
  }
}
* { box-sizing: border-box; }
html, body { height: 100%; margin: 0; }
body { display: flex; background: var(--bg); color: var(--text); font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
#side { width: 340px; flex: none; overflow-y: auto; background: var(--panel); border-right: 1px solid var(--line); padding: 16px; display: flex; flex-direction: column; gap: 16px; }
#stage { flex: 1; min-width: 0; display: flex; flex-direction: column; }
#cy { flex: 1; min-height: 0; }
#flowbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 16px; border-bottom: 1px solid var(--line); background: var(--panel); font-weight: 600; }
#flowbar[hidden] { display: none; }
h1 { font-size: 18px; margin: 0; }
h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin: 0 0 8px; }
.muted { color: var(--muted); margin: 2px 0 0; word-break: break-all; }
.small { font-size: 12px; }
section { display: flex; flex-direction: column; gap: 4px; }
label { display: flex; align-items: center; gap: 6px; cursor: pointer; }
input[type=search] { width: 100%; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--line); background: var(--bg); color: var(--text); font: inherit; }
.sw { display: inline-block; width: 18px; height: 0; border-top: 2px solid; flex: none; }
.sw.calls { border-color: var(--calls); }
.sw.references { border-color: var(--refs); border-top-style: dashed; }
.sw.imports { border-color: var(--imports); }
.sw.heuristic { border-color: var(--heur); border-top-style: dashed; }
.sw.route { border-color: var(--route); border-top-width: 3px; }
.route-item { text-align: left; display: block; width: 100%; }
.route-item small { display: block; color: var(--muted); }
.meter { height: 8px; border-radius: 4px; background: var(--line); overflow: hidden; }
.meter > div { height: 100%; background: var(--accent); }
.big { font-size: 28px; font-weight: 600; font-variant-numeric: tabular-nums; }
dl { display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; margin: 6px 0 0; font-size: 13px; }
dt { color: var(--muted); }
dd { margin: 0; font-variant-numeric: tabular-nums; word-break: break-all; }
button { font: inherit; padding: 6px 10px; border-radius: 8px; border: 1px solid var(--line); background: var(--bg); color: var(--text); cursor: pointer; }
button:hover { border-color: var(--accent); }
.row { display: flex; gap: 6px; flex-wrap: wrap; }
.weak-item { text-align: left; display: block; width: 100%; }
code { font-size: 12px; }
@media (max-width: 720px) { body { flex-direction: column; } #side { width: 100%; max-height: 45vh; border-right: 0; border-bottom: 1px solid var(--line); } }
`;

// Roda no navegador. Mantido como string pra o HTML sair num arquivo só, sem build.
const APP = String.raw`
(() => {
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const isTest = (id) => id.includes('/test/') || id.includes('/tests/') || id.includes('.test.') || id.includes('.spec.') || id.includes('test-e2e/');
  const fileOf = (n) => (n.kind === 'file' ? n.id : n.file);
  // dentro do webview do VS Code: o botão "Abrir código" fala com a extensão
  const vscodeApi = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : undefined;
  const state = { group: true, filters: { routes: true, calls: true, references: true, imports: false, packages: true, tests: false, isolated: false } };

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

  // ---- painel de cobertura
  const s = SYSTEM.stats;
  const internal = s.callsResolved + s.callsHeuristic + s.callsUnresolved;
  const pct = internal === 0 ? 100 : (100 * s.callsResolved) / internal;
  document.getElementById('hash').textContent = SYSTEM.contentHash.slice(0, 16);
  document.getElementById('coverage').innerHTML =
    '<h2>Cobertura das chamadas internas</h2>' +
    '<div class="big">' + pct.toFixed(1) + '%</div><div class="meter"><div id="meterfill"></div></div>' +
    '<dl><dt>provadas</dt><dd>' + s.callsResolved + '</dd><dt>heurística</dt><dd>' + s.callsHeuristic + '</dd>' +
    '<dt>sem alvo</dt><dd>' + s.callsUnresolved + '</dd><dt>p/ pacotes</dt><dd>' + s.callsExternal + '</dd>' +
    '<dt>imports quebrados</dt><dd>' + s.importsUnresolved + '</dd>' +
    '<dt>arquivos</dt><dd>' + s.files + '</dd><dt>símbolos</dt><dd>' + s.symbols + '</dd><dt>pacotes</dt><dd>' + s.packages + '</dd>' +
    '<dt>regras / colisões</dt><dd>' + s.rules + ' / ' + s.collisions + '</dd></dl>';
  // largura via CSSOM: atributo style="" em HTML é bloqueado pela CSP do webview
  document.getElementById('meterfill').style.width = pct + '%';

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
    const linked = new Set(edges.flatMap((e) => [e.source, e.target]));

    // símbolo sem nenhuma aresta visível só polui a leitura do fluxo (a menos que pedido)
    const nodes = candidates.filter((n) => n.kind === 'file' || f.isolated || linked.has(n.id));
    const usedFiles = new Set(nodes.filter((n) => n.file).map((n) => n.file));
    const out = [];
    for (const n of nodes) {
      // arquivo vira caixa só se tiver símbolo dentro ou aresta própria (ex.: references do topo)
      if (n.kind === 'file' && (!state.group || (!usedFiles.has(n.id) && !linked.has(n.id)))) continue;
      const data = { id: n.id, label: n.kind === 'file' ? n.id : n.name, kind: n.kind, raw: n };
      if (state.group && n.file) data.parent = n.file;
      out.push({ data, classes: 'k-' + n.kind });
    }
    const shown = new Set(out.map((e) => e.data.id));
    const edgeIds = new Set();
    for (const e of edges) {
      const id = e.source + '|' + e.type + '|' + e.target;
      if (!shown.has(e.source) || !shown.has(e.target) || edgeIds.has(id)) continue;
      edgeIds.add(id);
      out.push({ data: { id, source: e.source, target: e.target, type: e.type }, classes: 'e-' + e.type + (e.heuristic ? ' heuristic' : '') });
    }
    return out;
  }

  const style = [
    { selector: 'node', style: { label: 'data(label)', 'font-size': 10, 'min-zoomed-font-size': 7, color: css('--text'), 'text-valign': 'bottom', 'text-margin-y': 3, width: 14, height: 14, 'background-color': css('--fn'), 'text-max-width': 140, 'text-wrap': 'ellipsis' } },
    { selector: '.k-method', style: { 'background-color': css('--method') } },
    { selector: '.k-class', style: { 'background-color': css('--class'), shape: 'round-rectangle', width: 18, height: 14 } },
    { selector: '.k-selector', style: { 'background-color': css('--muted'), width: 8, height: 8 } },
    { selector: '.k-package', style: { 'background-color': css('--pkg'), shape: 'diamond', width: 22, height: 22, 'font-weight': 600 } },
    { selector: ':parent', style: { 'background-color': css('--file'), 'background-opacity': 1, 'border-color': css('--file-border'), 'border-width': 1, shape: 'round-rectangle', 'text-valign': 'top', 'text-halign': 'center', 'font-size': 11, color: css('--muted'), padding: 10 } },
    { selector: '.k-file:childless', style: { 'background-color': css('--file-border'), shape: 'round-rectangle', width: 16, height: 12 } },
    { selector: 'edge', style: { width: 1.2, 'curve-style': 'bezier', 'target-arrow-shape': 'triangle', 'arrow-scale': 0.7, 'line-color': css('--calls'), 'target-arrow-color': css('--calls'), opacity: 0.75 } },
    { selector: '.e-references', style: { 'line-style': 'dashed', 'line-color': css('--refs'), 'target-arrow-color': css('--refs') } },
    { selector: '.e-imports', style: { 'line-color': css('--imports'), 'target-arrow-color': css('--imports'), opacity: 0.5 } },
    { selector: '.heuristic', style: { 'line-style': 'dashed', 'line-color': css('--heur'), 'target-arrow-color': css('--heur') } },
    { selector: '.k-route', style: { 'background-color': css('--route'), shape: 'tag', width: 26, height: 18, 'font-weight': 700, 'font-size': 11 } },
    { selector: '.k-io-db', style: { 'background-color': css('--db'), shape: 'barrel', width: 20, height: 20, 'font-weight': 600 } },
    { selector: '.k-io-api', style: { 'background-color': css('--api'), shape: 'hexagon', width: 22, height: 20, 'font-weight': 600 } },
    { selector: '.e-route', style: { width: 2, 'line-color': css('--route'), 'target-arrow-color': css('--route') } },
    { selector: '.e-io', style: { width: 2, 'line-color': css('--db'), 'target-arrow-color': css('--db') } },
    { selector: '.faded', style: { opacity: 0.08 } },
    { selector: '.hl', style: { opacity: 1, 'z-index': 10 } },
    { selector: 'edge.hl', style: { width: 2.4 } },
    { selector: 'node:selected', style: { 'border-width': 3, 'border-color': css('--hl') } },
  ];

  let cy;
  function mount(els, layout) {
    if (cy) cy.destroy();
    cy = cytoscape({ container: document.getElementById('cy'), elements: els, style, minZoom: 0.05 });
    cy.layout(layout).run();
    cy.on('tap', 'node', (ev) => select(ev.target));
    cy.on('tap', (ev) => { if (ev.target === cy) { cy.elements().unselect(); clearHighlight(); } });
  }
  function build() {
    document.getElementById('flowbar').hidden = true;
    const els = elements();
    const big = els.length > 6000;
    mount(els, { name: 'fcose', quality: big ? 'draft' : 'default', randomize: true, animate: false, nodeDimensionsIncludeLabels: true, packComponents: true, padding: 30, idealEdgeLength: 70, nodeRepulsion: 6500, nestingFactor: 0.6 });
  }

  /**
   * Modo fluxo: só a cadeia escolhida, em camadas a partir da raiz, sem as caixas de agrupamento.
   * Arquivo continua quando é ponta de aresta (o módulo de rotas é quem registra os handlers).
   */
  function showFlow(collection, root, title) {
    const els = collection
      .map((el) => {
        const data = Object.assign({}, el.data());
        delete data.parent;
        return { group: el.isEdge() ? 'edges' : 'nodes', data, classes: el.classes().filter((c) => c !== 'faded' && c !== 'hl').join(' ') };
      });
    const rootId = root.id();
    mount(els, { name: 'breadthfirst', directed: true, roots: (n) => n.id() === rootId, spacingFactor: 1.15, animate: false, nodeDimensionsIncludeLabels: true, padding: 40 });
    document.getElementById('flowtitle').textContent = title;
    document.getElementById('flowbar').hidden = false;
  }
  document.getElementById('back').onclick = () => build();

  // ---- seleção e cadeias
  const FLOW_TYPES = new Set(['calls', 'references', 'route', 'io']);
  const flowEdges = (eles) => eles.filter((e) => e.isEdge() && FLOW_TYPES.has(e.data('type')));
  function highlight(collection) {
    cy.elements().addClass('faded').removeClass('hl');
    collection.removeClass('faded').addClass('hl');
    collection.parents().removeClass('faded');
  }
  function clearHighlight() {
    cy.elements().removeClass('faded hl');
    document.getElementById('details').hidden = true;
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
  function select(node) {
    const raw = node.data('raw');
    cy.elements().unselect();
    node.select();
    highlight(node.closedNeighborhood().union(node.descendants()));
    const rows = [['tipo', raw.kind]];
    if (raw.route) {
      const r = raw.route;
      rows.push(['registro', r.file + ':' + (r.line + 1)], ['handlers', r.handlers.map((h) => h.label).join(' → ')]);
      rows.push(['operações', r.operations.map((o) => o.order + '. ' + o.kind + ' ' + o.target).join(' · ') || '—']);
      rows.push(['tags', r.tags.map((t) => t.tag + (t.targets ? '(' + t.targets.join(',') + ')' : '')).join(', ') || '—']);
      rows.push(['confiança', r.confidence + (r.truncated ? ' (percurso truncado)' : '')]);
    }
    if (raw.op) {
      rows.push(['via', raw.op.via + (raw.op.operation ? ' · ' + raw.op.operation : '')]);
      if (raw.op.timeout) rows.push(['timeout', raw.op.timeout]);
      if (raw.op.lock) rows.push(['trava', 'FOR UPDATE']);
    }
    if (raw.file) rows.push(['arquivo', raw.file]);
    if (raw.startLine !== undefined) rows.push(['linhas', (raw.startLine + 1) + '–' + (raw.endLine + 1)]);
    if (raw.container) rows.push(['contêiner', raw.container]);
    if (raw.signature) rows.push(['assinatura', raw.signature]);
    if (raw.returns && raw.returns.length) rows.push(['retorna', raw.returns.join('.')]);
    if (raw.extends) rows.push(['extends', raw.extends.join('.')]);
    if (raw.implements) rows.push(['implements', raw.implements.join(', ')]);
    const outCalls = flowEdges(node.outgoers()).length;
    const inCalls = flowEdges(node.incomers()).length;
    rows.push(['sai / chega', outCalls + ' / ' + inCalls]);
    const el = document.getElementById('details');
    el.hidden = false;
    el.innerHTML = '<h2>' + escape(raw.name) + '</h2><dl>' + rows.map(([k, v]) => '<dt>' + k + '</dt><dd>' + escape(String(v)) + '</dd>').join('') + '</dl>' +
      '<div class="row"><button id="down">Cadeia abaixo</button><button id="up">Quem chega aqui</button><button id="clear">Limpar</button>' +
      (vscodeApi && (raw.file || raw.kind === 'file' || raw.route) ? '<button id="open">Abrir código</button>' : '') + '</div>';
    document.getElementById('down').onclick = () => showFlow(chain(node, 'down'), node, 'Cadeia a partir de ' + raw.name);
    document.getElementById('up').onclick = () => showFlow(chain(node, 'up'), node, 'Quem chega em ' + raw.name);
    document.getElementById('clear').onclick = () => { cy.elements().unselect(); clearHighlight(); };
    const open = document.getElementById('open');
    // rota abre onde ela é registrada
    if (open && raw.route) open.onclick = () => vscodeApi.postMessage({ type: 'open', file: raw.route.file, line: raw.route.line });
    else if (open) open.onclick = () => vscodeApi.postMessage({ type: 'open', file: raw.kind === 'file' ? raw.id : raw.file, line: raw.startLine || 0 });
  }
  function escape(t) {
    return t.split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;');
  }
  function focus(id) {
    const node = cy.getElementById(id);
    if (node.empty()) return false;
    cy.animate({ center: { eles: node }, zoom: Math.max(cy.zoom(), 1.2) }, { duration: 250 });
    select(node);
    return true;
  }

  // ---- busca, filtros, pontos fracos
  document.getElementById('search').addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter') return;
    const q = ev.target.value.trim().toLowerCase();
    if (!q) return clearHighlight();
    const hit = cy.nodes().filter((n) => n.data('label').toLowerCase().includes(q) || n.id().toLowerCase().includes(q));
    if (hit.empty()) return;
    focus(hit[0].id());
    if (hit.length > 1) highlight(hit);
  });
  for (const box of document.querySelectorAll('[data-filter]')) {
    box.addEventListener('change', () => { state.filters[box.dataset.filter] = box.checked; build(); });
  }
  document.getElementById('group').addEventListener('change', (ev) => { state.group = ev.target.checked; build(); });

  const weak = document.getElementById('weak');
  if (SYSTEM.weakSpots.length === 0) {
    weak.innerHTML = '<h2>Pontos fracos</h2><p class="muted small">Nenhum: todas as chamadas internas foram provadas.</p>';
  } else {
    weak.innerHTML = '<h2>Pontos fracos (' + SYSTEM.weakSpots.length + ')</h2>';
    for (const w of SYSTEM.weakSpots) {
      const b = document.createElement('button');
      b.className = 'weak-item';
      b.textContent = w.file + ' — ' + w.callsUnresolved + ' sem alvo, ' + w.callsHeuristic + ' heurística(s)' + (w.importsUnresolved.length ? ', imports: ' + w.importsUnresolved.join(', ') : '');
      b.onclick = () => {
        if (!focus(w.file)) {
          state.group = true; document.getElementById('group').checked = true;
          if (isTest(w.file)) { state.filters.tests = true; document.querySelector('[data-filter=tests]').checked = true; }
          build(); focus(w.file);
        }
      };
      weak.appendChild(b);
    }
  }

  // ---- lista de rotas (com topologia): cada uma abre o fluxo rota → handlers → ... → I/O
  if (TOPOLOGY) {
    const list = document.getElementById('routes');
    list.hidden = false;
    list.innerHTML = '<h2>Rotas (' + TOPOLOGY.routes.length + ')</h2>' + (TOPOLOGY.routes.length === 0 ? '<p class="muted small">Nenhuma rota Express encontrada.</p>' : '');
    for (const r of TOPOLOGY.routes) {
      const b = document.createElement('button');
      b.className = 'route-item';
      b.textContent = r.id;
      const tags = document.createElement('small');
      tags.textContent = r.operations.length + ' operação(ões)' + (r.tags.length ? ' · ' + r.tags.map((t) => t.tag).join(', ') : '');
      b.appendChild(tags);
      b.onclick = () => {
        if (!state.filters.routes) { state.filters.routes = true; document.querySelector('[data-filter=routes]').checked = true; build(); }
        const node = cy.getElementById(routeId(r));
        if (!node.empty()) showFlow(chain(node, 'down'), node, r.id);
      };
      list.appendChild(b);
    }
  }

  build();

  // link direto: #foco=<id> seleciona um nó; #fluxo=<id> abre a cadeia a partir dele; #rota=POST /x abre a rota
  const hash = decodeURIComponent(location.hash.slice(1));
  const [mode, target] = [hash.slice(0, hash.indexOf('=')), hash.slice(hash.indexOf('=') + 1)];
  if (mode === 'rota' && TOPOLOGY) {
    const node = cy.getElementById('route:' + target);
    if (!node.empty()) showFlow(chain(node, 'down'), node, target);
  }
  if (target && (mode === 'foco' || mode === 'fluxo')) {
    const node = cy.nodes().filter((n) => n.id() === target || n.id().startsWith(target + ':'))[0];
    if (node && mode === 'foco') focus(node.id());
    if (node && mode === 'fluxo') showFlow(chain(node, 'down'), node, 'Cadeia a partir de ' + node.data('raw').name);
  }
})();
`;

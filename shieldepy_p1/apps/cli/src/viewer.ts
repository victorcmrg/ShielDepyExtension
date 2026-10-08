// Visualizador do mapa do sistema: um HTML autocontido (Cytoscape.js + dados embutidos), que
// abre offline em qualquer navegador. É a ferramenta de CONFERÊNCIA do mapeamento (E1): ver se a
// cadeia rota → serviço → repositório → pacote está certa e onde o mapa ainda adivinha.
// O visualizador "de produto" (extensão/portal, com topologia e resultados do caos) vem depois —
// ver PLANO-CHAOS.md.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { SystemGraph } from '@shieldepy/core';

const require = createRequire(import.meta.url);

/**
 * Cytoscape + layout fcose (feito pra grafos com nós compostos — arquivo contendo símbolos).
 * UMD na ordem de dependência; o fcose se registra sozinho ao achar o `cytoscape` global.
 */
function librarySources(): string[] {
  const files = [
    // o `exports` do cytoscape mapeia `./dist/*` → `./dist/*.js`: o caminho vai sem extensão
    require.resolve('cytoscape/dist/cytoscape.min'),
    require.resolve('layout-base/layout-base.js'),
    require.resolve('cose-base/cose-base.js'),
    require.resolve('cytoscape-fcose/cytoscape-fcose.js'),
  ];
  return files.map((f) => readFileSync(f, 'utf8').split('</script').join('<\\/script'));
}

/** JSON seguro dentro de <script>: `<` vira `\u003c` (no JSON, `<` só aparece dentro de strings). */
function embedJson(value: unknown): string {
  return JSON.stringify(value).split('<').join('\\u003c');
}

function escapeHtml(text: string): string {
  return text.split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;').split('"').join('&quot;');
}

export function renderGraphHtml(system: SystemGraph, label: string): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mapa — ${escapeHtml(label)}</title>
<style>${STYLE}</style>
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
  <section id="weak"></section>
  <footer class="muted small">hash <code id="hash"></code></footer>
</aside>
<main id="stage">
  <div id="flowbar" hidden><span id="flowtitle"></span><button id="back">Voltar ao mapa</button></div>
  <div id="cy" aria-label="Grafo do sistema"></div>
</main>
${librarySources()
  .map((src) => `<script>${src}</script>`)
  .join('\n')}
<script>const SYSTEM = ${embedJson(system)};</script>
<script>${APP}</script>
</body>
</html>
`;
}

const STYLE = `
:root {
  --bg: #f7f7f5; --panel: #ffffff; --text: #1d1d1f; --muted: #6b6b70; --line: #e3e3e0;
  --file: #eef2f7; --file-border: #c9d3e0; --fn: #2f6fdf; --method: #7a4fd1; --class: #0f8a6a;
  --pkg: #b5651d; --calls: #4a5568; --refs: #2f6fdf; --imports: #b9bcc4; --heur: #e0861a;
  --hl: #e5484d; --accent: #2f6fdf;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #141416; --panel: #1c1c1f; --text: #ececee; --muted: #9a9aa2; --line: #2c2c31;
    --file: #22262e; --file-border: #3a4150; --fn: #6aa0ff; --method: #b294ff; --class: #3fcf9f;
    --pkg: #e3a15c; --calls: #a0a7b4; --refs: #6aa0ff; --imports: #4a4e57; --heur: #f0a040;
    --hl: #ff6b6f; --accent: #6aa0ff;
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
  const state = { group: true, filters: { calls: true, references: true, imports: false, packages: true, tests: false, isolated: false } };

  // ---- painel de cobertura
  const s = SYSTEM.stats;
  const internal = s.callsResolved + s.callsHeuristic + s.callsUnresolved;
  const pct = internal === 0 ? 100 : (100 * s.callsResolved) / internal;
  document.getElementById('hash').textContent = SYSTEM.contentHash.slice(0, 16);
  document.getElementById('coverage').innerHTML =
    '<h2>Cobertura das chamadas internas</h2>' +
    '<div class="big">' + pct.toFixed(1) + '%</div><div class="meter"><div style="width:' + pct + '%"></div></div>' +
    '<dl><dt>provadas</dt><dd>' + s.callsResolved + '</dd><dt>heurística</dt><dd>' + s.callsHeuristic + '</dd>' +
    '<dt>sem alvo</dt><dd>' + s.callsUnresolved + '</dd><dt>p/ pacotes</dt><dd>' + s.callsExternal + '</dd>' +
    '<dt>imports quebrados</dt><dd>' + s.importsUnresolved + '</dd>' +
    '<dt>arquivos</dt><dd>' + s.files + '</dd><dt>símbolos</dt><dd>' + s.symbols + '</dd><dt>pacotes</dt><dd>' + s.packages + '</dd>' +
    '<dt>regras / colisões</dt><dd>' + s.rules + ' / ' + s.collisions + '</dd></dl>';

  // ---- elementos
  function elements() {
    const f = state.filters;
    const candidates = SYSTEM.nodes.filter((n) => {
      if (n.kind === 'file' && n.external) return false;
      if (!f.tests && isTest(fileOf(n) || '')) return false;
      if (n.kind === 'package' && !f.packages) return false;
      return true;
    });
    const present = new Set(candidates.map((n) => n.id));
    const edges = SYSTEM.edges.filter((e) => e.type !== 'defines' && f[e.type] && present.has(e.source) && present.has(e.target));
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
    for (const e of edges) {
      if (!shown.has(e.source) || !shown.has(e.target)) continue;
      out.push({ data: { id: e.source + '|' + e.type + '|' + e.target, source: e.source, target: e.target, type: e.type }, classes: 'e-' + e.type + (e.heuristic ? ' heuristic' : '') });
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
  const flowEdges = (eles) => eles.filter((e) => e.isEdge() && (e.data('type') === 'calls' || e.data('type') === 'references'));
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
      '<div class="row"><button id="down">Cadeia abaixo</button><button id="up">Quem chega aqui</button><button id="clear">Limpar</button></div>';
    document.getElementById('down').onclick = () => showFlow(chain(node, 'down'), node, 'Cadeia a partir de ' + raw.name);
    document.getElementById('up').onclick = () => showFlow(chain(node, 'up'), node, 'Quem chega em ' + raw.name);
    document.getElementById('clear').onclick = () => { cy.elements().unselect(); clearHighlight(); };
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

  build();

  // link direto: #foco=<id> seleciona um nó; #fluxo=<id> abre a cadeia a partir dele
  const hash = decodeURIComponent(location.hash.slice(1));
  const [mode, target] = [hash.slice(0, hash.indexOf('=')), hash.slice(hash.indexOf('=') + 1)];
  if (target && (mode === 'foco' || mode === 'fluxo')) {
    const node = cy.nodes().filter((n) => n.id() === target || n.id().startsWith(target + ':'))[0];
    if (node && mode === 'foco') focus(node.id());
    if (node && mode === 'fluxo') showFlow(chain(node, 'down'), node, 'Cadeia a partir de ' + node.data('raw').name);
  }
})();
`;

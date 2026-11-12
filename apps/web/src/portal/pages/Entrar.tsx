// O "Entrar" da landing (decisão 0039, segunda versão, com o roteiro ditado pelo usuário): um 404
// grande no meio da tela por 3 s; a gravidade derruba o texto e os números, que tombam em 3D no
// chão; a câmera aproxima, o ShielDepy detecta o erro num balão verde que se divide como líquido, e
// quatro cursores reconstroem a tela de login (desenham a caixa, empurram e jogam fora os balões,
// escolhem a cor numa paleta, arrumam o logo, apagam o título errado, desenham os campos, pintam o
// botão) até 100%. A tela final é mockada e aponta para o /login de verdade, que não mudou.
//
// Esta página só monta a cena; quem anima é entrar/engine.ts, num requestAnimationFrame que escreve
// transform e opacity direto no DOM. Clique ou tecla pula para o fim; com prefers-reduced-motion, o
// 404 vai direto para a tela pronta.
import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import '../../styles/entrar.css';
import { runEntrar } from './entrar/engine';
import { TITLE, TITLE_WRONG } from './entrar/script';

const MSG = 'Página não encontrada';
const DIGIT_LAYERS = 26;
const LETTER_LAYERS = 8;

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

export default function Entrar() {
  const [reduced] = useState(prefersReducedMotion);
  const [done, setDone] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.title = done ? 'Entrar — ShielDepy' : '404';
    if (done) delete document.documentElement.dataset.boot;
  }, [done]);
  useEffect(() => () => void delete document.documentElement.dataset.boot, []);

  // a encenação (ou, sem movimento, só o 404 parado e depois a tela pronta)
  useEffect(() => {
    if (done) return;
    if (reduced) {
      const id = window.setTimeout(() => setDone(true), 3000);
      return () => window.clearTimeout(id);
    }
    return runEntrar(rootRef.current!, () => setDone(true));
  }, [done, reduced]);

  // clique ou tecla: pula para o fim
  useEffect(() => {
    if (done) return;
    const skip = () => setDone(true);
    window.addEventListener('pointerdown', skip);
    window.addEventListener('keydown', skip);
    return () => {
      window.removeEventListener('pointerdown', skip);
      window.removeEventListener('keydown', skip);
    };
  }, [done]);

  return (
    <div className={'ent' + (done ? ' is-done' : '')} ref={rootRef}>
      <div className="ent-bg2" aria-hidden="true" />
      {!done && <Scene />}
      <FinalLogin ghost={!done} />
    </div>
  );
}

function Glyph({ ch, kind }: { ch: string; kind: 'digit' | 'letter' }) {
  const n = kind === 'digit' ? DIGIT_LAYERS : LETTER_LAYERS;
  return (
    <span className="ent-g" data-kind={kind} data-ch={ch} aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <i key={i} style={{ '--n': n - i } as CSSProperties}>
          {ch}
        </i>
      ))}
      <b>{ch}</b>
    </span>
  );
}

function Cursor({ id }: { id: string }) {
  return (
    <>
      <div className="ent-w ent-cur-sh" data-id={id} aria-hidden="true">
        <svg viewBox="0 0 100 100">
          <path d="M4 4 L66 17 A41 41 0 1 1 17 66 Z" />
        </svg>
      </div>
      <div className="ent-w ent-cur" data-id={id} data-chaos={id === 'x' || id === 'y' ? '' : undefined} aria-hidden="true">
        <svg viewBox="0 0 100 100" className="ent-cur-svg">
          {/* a ponta (o "bico" do cursor) atrás do corpo redondo, separada por uma linha branca */}
          <path className="ent-cur-tip" d="M4 4 L66 17 A41 41 0 1 1 17 66 Z" />
          <circle cx="57" cy="57" r="37" className="ent-cur-body" />
          <g className="eyes">
            <g className="eyes-in">
              <rect x="38.5" y="37" width="13.5" height="36" rx="6.75" />
              <rect x="62" y="37" width="13.5" height="36" rx="6.75" />
            </g>
          </g>
        </svg>
        {/* pensando: um balãozinho com reticências */}
        <span className="ent-think">
          <i />
          <i />
          <i />
        </span>
      </div>
    </>
  );
}

function Ball() {
  return (
    <span className="ent-chip" aria-hidden="true">
      <span className="ent-ball" />
      <svg className="ent-ring" viewBox="0 0 40 40">
        <circle cx="20" cy="20" r="17" />
      </svg>
      <span className="ent-check">✓</span>
    </span>
  );
}

function Scene() {
  const glyphCount = 3 + MSG.replace(/ /g, '').length;
  return (
    <div className="ent-scene">
      {/* o filtro do "líquido": borra e corta de novo, e dois blocos perto viram um só */}
      <svg width="0" height="0" className="ent-defs" aria-hidden="true">
        <filter id="ent-goo">
          <feGaussianBlur in="SourceGraphic" stdDeviation="12" result="b" />
          <feColorMatrix in="b" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 24 -10" />
        </filter>
      </svg>

      {/* o 404 em 3D de verdade (three.js) por baixo da câmera, e o confete do fim por cima de tudo */}
      <canvas className="ent-gl" aria-hidden="true" />
      <div className="ent-cam">
        <div className="ent-letters">
          <div className="ent-shadows" aria-hidden="true">
            {Array.from({ length: glyphCount }, (_, i) => (
              <span key={i} className="ent-sh" />
            ))}
          </div>
          <h1 className="ent-404" aria-label="404">
            {['4', '0', '4'].map((d, i) => (
              <Glyph key={i} ch={d} kind="digit" />
            ))}
          </h1>
          <p className="ent-msg" aria-label={MSG}>
            {MSG.split('').map((ch, i) => (ch === ' ' ? <span key={i} className="ent-space" /> : <Glyph key={i} ch={ch} kind="letter" />))}
          </p>
        </div>

        <div className="ent-goo" aria-hidden="true">
          <span className="ent-w goo g0" />
          <span className="ent-w goo g1" />
          <span className="ent-w goo g2" />
        </div>
        <div className="ent-w ent-pop p0">
          <div className="ent-pop-body">
            <span className="ent-pop-tag">GET /entrar · 404</span>
            <Ball />
            <strong>Erro detectado</strong>
            <span className="ent-pop-sub">
              <span className="sub-a">corrigindo…</span>
              <span className="sub-b">verificando…</span>
            </span>
          </div>
        </div>
        <div className="ent-w ent-pop p1">
          <div className="ent-pop-body">
            <span className="ent-pop-tag">rota</span>
            <Ball />
            <strong>Ajustando rota</strong>
            <span className="ent-pop-sub">/entrar → /login</span>
          </div>
        </div>
        <div className="ent-w ent-pop p2">
          <div className="ent-pop-body">
            <span className="ent-pop-tag">tela</span>
            <Ball />
            <strong>Corrigindo tela de login</strong>
            <span className="ent-pop-sub">8 blocos fora do lugar</span>
          </div>
        </div>

        {['logo', 'title', 'subtitle', 'email', 'pass', 'button', 'back'].map((k) => (
          <span key={k} className="ent-w ent-slot" data-k={k} aria-hidden="true" />
        ))}
        <div className="ent-w ent-box" aria-hidden="true">
          <span className="ent-box-fill" />
        </div>
        <span className="ent-w ent-seed" aria-hidden="true" />

        {['p0', 'p1', 'p2', 'sub', 'back', 'box', 'pal', 'graph', 'spn', 'spc', 'fonts'].map((k) => (
          <span key={k} className="ent-w ent-psh" data-for={k} aria-hidden="true" />
        ))}
        {/* o "+" que o primeiro cursor abre para criar os outros */}
        <span className="ent-w ent-spawner normal" aria-hidden="true">
          <span className="sp-ico" />
          <span className="sp-label">cursores</span>
          <b className="sp-n">01</b>
          <span className="sp-plus" />
        </span>
        <span className="ent-w ent-spawner chaos" aria-hidden="true">
          <span className="sp-ico" />
          <span className="sp-label">agentes do caos</span>
          <b className="sp-n">00</b>
          <span className="sp-plus" />
        </span>
        {/* o mapa das ligações que o agente X analisa */}
        <div className="ent-w ent-graph" aria-hidden="true">
          <span className="g-title">grafo · rotas</span>
          <svg>
            <line className="ge" />
            <line className="ge is-broken" />
            <line className="ge" />
            <line className="ge" />
          </svg>
          {['/', '/entrar', '<Login/>', '/login', '/api/auth'].map((label) => (
            <span key={label} className="gn">
              {label}
            </span>
          ))}
          <span className="g-pin">achado #1 · /entrar → ∅</span>
          <span className="g-ok">✓ resolvido · /entrar → &lt;Login/&gt;</span>
        </div>
        {/* o DevTools que o agente Y puxa da borda (recriado, genérico) */}
        <div className="ent-w ent-dev" aria-hidden="true">
          <div className="dv-head">
            <span className="dv-tab">Elementos</span>
            <span className="dv-tab dv-console">Console</span>
            <span className="dv-tab">Fontes</span>
            <span className="dv-tab">Rede</span>
            <span className="dv-tab">Desempenho</span>
            <span className="dv-count" />
          </div>
          <div className="dv-bar">
            <span>top ▾</span>
            <span className="dv-filter">Filtrar</span>
          </div>
          <div className="dv-lines">
            <div className="dl err">
              GET http://localhost/entrar <b>404 (Not Found)</b>
            </div>
            <div className="dl err">Failed to load resource: the server responded with a status of 404</div>
            <div className="dl warn">[router] nenhuma rota casa com /entrar</div>
            <div className="dl err">Uncaught Error: &lt;Login/&gt; não foi montado</div>
            <div className="dl ok">✓ /entrar → &lt;Login/&gt; · 200</div>
            <div className="dl ok">✓ 0 erros · tela de login montada</div>
          </div>
          <span className="dv-pin">achado #2 · 404</span>
        </div>
        <svg className="ent-w ent-tether" width="1" height="1" aria-hidden="true">
          <line />
        </svg>
        {/* o blueprint de motion graphics: caixa com alças, âncora com os eixos e o arco de rotação */}
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="ent-w ent-gizmo" aria-hidden="true">
            <span className="gz-tag" />
            {[1, 2, 3, 4, 5, 6, 7, 8].map((h) => (
              <i key={h} className={`gz-h gz-h${h}`} />
            ))}
            <span className="gz-anchor" />
            <span className="gz-x" />
            <span className="gz-y" />
            <span className="gz-rot" />
          </div>
        ))}
        <svg className="ent-w ent-mpath" width="1" height="1" aria-hidden="true">
          <defs>
            <marker id="ent-node" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="7" markerHeight="7">
              <circle cx="5" cy="5" r="3.4" />
            </marker>
          </defs>
          <path className="mp-sub" markerStart="url(#ent-node)" markerEnd="url(#ent-node)" />
          <path className="mp-back" markerStart="url(#ent-node)" markerEnd="url(#ent-node)" />
        </svg>
        <div className="ent-w ent-logo" aria-hidden="true">
          <img src="/logo-mark.svg" alt="" />
          <span>ShielDepy</span>
        </div>
        <div className="ent-w ent-wtitle" aria-hidden="true">
          {TITLE_WRONG.split('').map((ch, i) => (
            <span key={i} className="wl">
              {ch === ' ' ? ' ' : ch}
            </span>
          ))}
        </div>
        <div className="ent-w ent-title" aria-hidden="true">
          <span className="ent-title-in" />
        </div>
        <div className="ent-w ent-fonts" aria-hidden="true">
          <span className="fo fo-serif">
            Aa<small>serifada</small>
          </span>
          <span className="fo fo-mono">
            Aa<small>mono</small>
          </span>
          <span className="fo fo-brand">
            Aa<small>Manrope</small>
          </span>
        </div>
        <div className="ent-w ent-sub" data-carry="sub" aria-hidden="true">
          Conecte sua conta à extensão ShielDepy.
        </div>
        <div className="ent-w ent-label le" aria-hidden="true">
          E-mail
        </div>
        <div className="ent-w ent-field fe" aria-hidden="true">
          voce@empresa.com
        </div>
        <div className="ent-w ent-label lp" aria-hidden="true">
          Senha
        </div>
        <div className="ent-w ent-field fp" aria-hidden="true">
          ••••••••
        </div>
        <div className="ent-w ent-cpf" aria-hidden="true">
          CPF ___.___.___-__
        </div>
        <div className="ent-w ent-btn" aria-hidden="true">
          <span className="ent-btn-paint" />
          <span className="ent-btn-label">Entrar</span>
        </div>
        <div className="ent-w ent-backlink" data-carry="back" aria-hidden="true">
          ← Voltar para o início
        </div>
        <span className="ent-w ent-draw de" aria-hidden="true" />
        <span className="ent-w ent-draw dp" aria-hidden="true" />
        <span className="ent-w ent-draw db" aria-hidden="true" />

        <div className="ent-w ent-palette" aria-hidden="true">
          <span className="sw" />
          <span className="sw" />
          <span className="sw" />
          <span className="sw" />
          <span className="sw" />
        </div>

        {['a', 'b', 'c', 'd', 'x', 'y'].map((id) => (
          <Cursor key={id} id={id} />
        ))}
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="ent-w ent-rip" aria-hidden="true" />
        ))}
        {Array.from({ length: 18 }, (_, i) => (
          <span key={i} className="ent-w ent-spark" aria-hidden="true" />
        ))}
      </div>

      <canvas className="ent-fx" aria-hidden="true" />
      <div className="ent-prog" aria-hidden="true">
        reconstruindo a tela · <span className="ent-prog-n">0</span>%
      </div>
      <p className="ent-sr" role="status">
        Página não encontrada. O ShielDepy está reconstruindo a tela de login; clique ou aperte uma tecla para pular.
      </p>
    </div>
  );
}

function FinalLogin({ ghost }: { ghost: boolean }) {
  const [note, setNote] = useState(false);
  function submit(e: FormEvent) {
    e.preventDefault();
    setNote(true);
  }
  return (
    <div className={'ent-final' + (ghost ? ' is-ghost' : '')} aria-hidden={ghost}>
      <div className="auth-page">
        <div className="auth-page-inner">
          <div className="auth-logo" data-m="logo">
            <img src="/logo-mark.svg" alt="" />
            <span>ShielDepy</span>
          </div>
          <div className="auth-card" data-m="card">
            <h1>
              <span data-m="title">{TITLE}</span>
            </h1>
            <p className="muted" data-m="subtitle">
              Conecte sua conta à extensão ShielDepy.
            </p>
            <form onSubmit={submit} noValidate>
              <div className="field">
                <label htmlFor="ent-email" data-m="emailLabel">
                  E-mail
                </label>
                <input type="email" id="ent-email" placeholder="voce@empresa.com" autoComplete="off" data-m="email" tabIndex={ghost ? -1 : 0} />
              </div>
              <div className="field">
                <label htmlFor="ent-password" data-m="passLabel">
                  Senha
                </label>
                <input type="password" id="ent-password" placeholder="••••••••" autoComplete="off" data-m="pass" tabIndex={ghost ? -1 : 0} />
              </div>
              <button type="submit" className="primary" data-m="button" tabIndex={ghost ? -1 : 0}>
                Entrar
              </button>
            </form>
            {note && (
              <p className="ent-note" role="status">
                Esta tela é uma encenação: nada foi enviado. Para entrar de verdade, use o <a href="/login">login do portal</a>.
              </p>
            )}
          </div>
          <a className="back-link" href="/" data-m="back" tabIndex={ghost ? -1 : 0}>
            ← Voltar para o início
          </a>
        </div>
      </div>
    </div>
  );
}

// O "Entrar" da landing (decisão 0039): um 404 de mentira por 1,5 s e o ShielDepy reconstruindo a
// tela de login por cima, bloco por bloco, até ela ficar pronta. A tela final é mockada: não
// autentica nada e aponta para o login de verdade (/login), que segue intacto para a extensão e o
// OAuth. O roteiro (tempos, mensagens, ordem) fica em entrar/timeline.ts; aqui só se desenha.
//
// Leve de propósito: um requestAnimationFrame que só troca o passo quando o roteiro anda (e escreve
// o título decodificado direto no DOM); o resto é CSS com transform e opacity. Clique ou tecla pula
// para o fim; com prefers-reduced-motion, o 404 vai direto para a tela pronta.
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import '../../styles/entrar.css';
import {
  BLOCKS,
  DECODE_MS,
  EVENTS,
  NOT_FOUND_MS,
  REBUILD_MS,
  TITLE_BROKEN,
  TITLE_FIXED,
  decodeFrame,
  fixTime,
  snapshot,
  stageTime,
  stepAt,
  timecode,
  type BlockId,
  type LogLine,
} from './entrar/timeline';

type Phase = 'nf' | 'rebuild' | 'done';

const HUD_LINES = 7;

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

export default function Entrar() {
  const [reduced] = useState(prefersReducedMotion);
  const [phase, setPhase] = useState<Phase>('nf');
  const [step, setStep] = useState(0);
  const [note, setNote] = useState(false);
  // a reconstrução chegou a passar na tela (para o terminal sair com calma no fim, e não do nada)
  const [rebuilt, setRebuilt] = useState(false);
  const titleRef = useRef<HTMLSpanElement>(null);
  const cameraRef = useRef<HTMLDivElement>(null);
  const clockRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    document.title = phase === 'nf' ? '404' : 'Entrar — ShielDepy';
    // o theme-init.js marca o <html> em /entrar para o fundo nascer branco; daqui em diante a página cobre a tela
    if (phase !== 'nf') delete document.documentElement.dataset.boot;
  }, [phase]);
  useEffect(() => () => void delete document.documentElement.dataset.boot, []);

  // 1,5 s de 404 puro; depois, a reconstrução (ou direto a tela pronta, sem movimento)
  useEffect(() => {
    if (phase !== 'nf') return;
    const t = window.setTimeout(() => setPhase(reduced ? 'done' : 'rebuild'), NOT_FOUND_MS);
    return () => window.clearTimeout(t);
  }, [phase, reduced]);

  // o relógio da reconstrução
  useEffect(() => {
    if (phase !== 'rebuild') return;
    setRebuilt(true);
    const start = performance.now();
    const titleAt = fixTime('title');
    let raf = 0;
    let last = -1;
    const frame = (now: number) => {
      const elapsed = now - start;
      const n = stepAt(elapsed);
      if (n !== last) {
        last = n;
        setStep(n);
      }
      const span = titleRef.current;
      if (span) {
        const p = (elapsed - titleAt) / DECODE_MS;
        const text = p <= 0 ? TITLE_BROKEN : decodeFrame(TITLE_BROKEN, TITLE_FIXED, p, Math.floor(elapsed / 50));
        if (span.textContent !== text) span.textContent = text;
      }
      const clock = clockRef.current;
      if (clock) clock.textContent = timecode(NOT_FOUND_MS + elapsed);
      if (elapsed >= REBUILD_MS) {
        setPhase('done');
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  // clique ou tecla: pula para o fim
  useEffect(() => {
    if (phase === 'done') return;
    const skip = () => setPhase('done');
    window.addEventListener('pointerdown', skip);
    window.addEventListener('keydown', skip);
    return () => {
      window.removeEventListener('pointerdown', skip);
      window.removeEventListener('keydown', skip);
    };
  }, [phase]);

  // a "câmera": começa de perto e torta e se afasta até a tela ficar reta (Web Animations, só transform).
  // Pular acelera o que falta em vez de cortar seco.
  const hasSkeleton = phase === 'rebuild' && snapshot(step).stages.has('skeleton');
  useEffect(() => {
    const el = cameraRef.current;
    if (!hasSkeleton || !el || typeof el.animate !== 'function') return;
    const anim = el.animate(
      [
        { transform: 'translateY(5%) scale(1.24) rotate(-1.4deg)' },
        { transform: 'translateY(1.5%) scale(1.07) rotate(-0.4deg)', offset: 0.55 },
        { transform: 'none' },
      ],
      { duration: REBUILD_MS - stageTime('skeleton') - 500, easing: 'cubic-bezier(.3,.55,.15,1)', fill: 'backwards' }
    );
    return () => anim.updatePlaybackRate(12);
  }, [hasSkeleton]);

  useLayoutEffect(() => {
    if (phase === 'done' && titleRef.current) titleRef.current.textContent = TITLE_FIXED;
  }, [phase]);

  if (phase === 'nf') return <div className="nf-raw">404</div>;

  const done = phase === 'done';
  const snap = snapshot(done ? EVENTS.length : step);
  const isOk = (b: BlockId) => snap.fixed.has(b);
  const ok = (b: BlockId) => (isOk(b) ? '1' : '0');
  const rootClass = ['rb', done ? 'is-done' : '', ...[...snap.stages].map((s) => 'st-' + s)].filter(Boolean).join(' ');

  function submit(e: FormEvent) {
    e.preventDefault();
    setNote(true);
  }

  return (
    <div className={rootClass} aria-busy={!done}>
      <div className="rb-bg" aria-hidden="true" />
      <div className="rb-grid" aria-hidden="true" />
      <div className="rb-glow" aria-hidden="true" />

      {!done && (
        <>
          <div className="rb-scan" aria-hidden="true" />
          <div className="rb-flash" aria-hidden="true" />
          <div className="rb-nf" aria-hidden="true">
            404
            <span className="rb-nf-frame" />
            <span className="rb-nf-tag">erro 404</span>
          </div>
          <p className="rb-sr" role="status">
            Reconstruindo a tela de login. Clique ou aperte uma tecla para pular.
          </p>
        </>
      )}

      {snap.stages.has('skeleton') && (
        <div className="rb-camera" ref={cameraRef}>
        <div className="auth-page rb-page">
          <div className="auth-page-inner">
            <Block id="logo" ok={ok('logo')}>
              <div className="auth-logo">
                <img src="/logo-mark.svg" alt="" />
                <span className="rb-logo-alt">[img: logo-mark.svg]</span>
                <span>ShielDepy</span>
              </div>
            </Block>

            <div className="auth-card rb-block" data-block="card" data-ok={ok('card')}>
              <Tag ok={isOk('card')} />
              <span className="rb-sheen-wrap" aria-hidden="true">
                <span className="rb-sheen" />
              </span>
              <Block id="title" ok={ok('title')}>
                <h1 aria-label={TITLE_FIXED}>
                  <span ref={titleRef} aria-hidden="true" />
                </h1>
              </Block>
              <Block id="subtitle" ok={ok('subtitle')}>
                <p className="muted">Conecte sua conta à extensão ShielDepy.</p>
              </Block>

              <form onSubmit={submit} noValidate>
                <Block id="email" ok={ok('email')}>
                  <div className="field">
                    <label htmlFor="rb-email">{isOk('email') ? 'E-mail' : 'E_MAIL'}</label>
                    <input type="email" id="rb-email" placeholder="voce@empresa.com" autoComplete="off" />
                  </div>
                </Block>
                <Block id="password" ok={ok('password')}>
                  <div className="field">
                    <label htmlFor="rb-password">{isOk('password') ? 'Senha' : 'Snha'}</label>
                    <input
                      type={isOk('password') ? 'password' : 'text'}
                      id="rb-password"
                      placeholder={isOk('password') ? '••••••••' : 'senha à mostra'}
                      autoComplete="off"
                    />
                  </div>
                </Block>
                <Block id="button" ok={ok('button')}>
                  <button type="submit" className="primary">
                    {isOk('button') ? 'Entrar' : 'Entar'}
                  </button>
                </Block>
              </form>

              {note && (
                <p className="rb-note" role="status">
                  Esta tela é uma encenação: nada foi enviado. Para entrar de verdade, use o <a href="/login">login do portal</a>.
                </p>
              )}
            </div>

            <Block id="back" ok={ok('back')}>
              <a className="back-link" href="/">
                {isOk('back') ? '← Voltar para o início' : '<- Voltar para o inicio'}
              </a>
            </Block>
          </div>
        </div>
        </div>
      )}

      <div className="rb-vignette" aria-hidden="true" />
      <div className="rb-bars" aria-hidden="true">
        <div className="rb-bar rb-bar-top">
          <span>shieldepy · incidente 404 · /entrar</span>
        </div>
        <div className="rb-bar rb-bar-bottom">
          <span>clique ou aperte uma tecla para pular</span>
          <span>
            <i className="rb-rec" /> rec <span ref={clockRef}>{timecode(NOT_FOUND_MS)}</span>
          </span>
        </div>
      </div>

      {(!done || rebuilt) && <Hud logs={snap.logs} fixed={snap.fixed.size} leaving={done} />}
    </div>
  );
}

function Block({ id, ok, children }: { id: BlockId; ok: '0' | '1'; children: ReactNode }) {
  return (
    <div className="rb-block" data-block={id} data-ok={ok}>
      <Tag ok={ok === '1'} />
      {children}
    </div>
  );
}

function Tag({ ok }: { ok: boolean }) {
  return (
    <span className="rb-tag" aria-hidden="true">
      {ok ? '✓ ok' : '✗ erro'}
    </span>
  );
}

function Hud({ logs, fixed, leaving }: { logs: readonly LogLine[]; fixed: number; leaving: boolean }) {
  const first = Math.max(0, logs.length - HUD_LINES);
  return (
    <div className={'rb-hud' + (leaving ? ' is-leaving' : '')} aria-hidden="true">
      <div className="rb-hud-head">
        <span className="rb-hud-dot" />
        <span>shieldepy · reparo ao vivo</span>
        <span className="rb-hud-count">
          {fixed}/{BLOCKS.length} blocos
        </span>
      </div>
      <ol>
        {logs.slice(first).map((l, i) => (
          <li key={first + i} className={'tone-' + l.tone}>
            {l.text}
          </li>
        ))}
      </ol>
    </div>
  );
}

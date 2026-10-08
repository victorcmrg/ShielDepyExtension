// A prova: cadeado 3D gravado na frente do título; as duas regras se ligam nele por arestas que vão sendo
// desenhadas com a rolagem, e no fim aparece o veredito.
import { useEffect, useRef } from 'react';
import { clamp, put, reduceMotion } from '../motion';
import { Lede } from '../parts';
import { addScrollJob } from '../scroll';
import { LockCanvas } from './LockCanvas';

export function Proof() {
  const boardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const board = boardRef.current!;
    const $ = <E extends Element>(id: string) => board.querySelector<E>('#' + id)!;
    const edge = $<SVGSVGElement>('edge');
    const edgePath = $<SVGPathElement>('edgePath');
    const edgePath2 = $<SVGPathElement>('edgePath2');
    const lockCanvas = $<HTMLCanvasElement>('lockCanvas');
    const verdict = $<HTMLElement>('verdict');
    const marks = Array.from(board.querySelectorAll('mark'));
    const reduce = reduceMotion();
    const lay = { top: 0, height: 0 };

    /** As duas regras ficam frente a frente, uma de cada lado do cadeado: cada aresta é uma reta que sai da
     *  borda do trecho, na altura do "total", e some atrás do corpo do cadeado. */
    function layoutEdge() {
      const b = board.getBoundingClientRect();
      const f = (n: number) => n.toFixed(1);
      edge.setAttribute('viewBox', `0 0 ${Math.round(b.width)} ${Math.round(b.height)}`);
      const lock = lockCanvas.offsetWidth ? lockCanvas.getBoundingClientRect() : null;
      const cx = lock ? lock.left + lock.width / 2 - b.left : b.width / 2;
      const sa = marks[0]!.closest('.snippet')!.getBoundingClientRect();
      const sb = marks[1]!.closest('.snippet')!.getBoundingClientRect();
      const a = marks[0]!.getBoundingClientRect();
      const c = marks[1]!.getBoundingClientRect();
      const ay = a.top + a.height / 2 - b.top;
      const by = c.top + c.height / 2 - b.top;
      edgePath.setAttribute('d', `M ${f(sa.right - b.left)} ${f(ay)} L ${f(cx)} ${f(ay)}`);
      edgePath2.setAttribute('d', `M ${f(sb.left - b.left)} ${f(by)} L ${f(cx)} ${f(by)}`);
    }

    return addScrollJob({
      measure() {
        lay.top = board.getBoundingClientRect().top + window.scrollY;
        lay.height = board.offsetHeight;
        layoutEdge();
      },
      frame() {
        const d = reduce ? 1 : clamp((window.innerHeight * 0.85 - (lay.top - window.scrollY)) / (lay.height * 0.9));
        const draw = d.toFixed(3);
        const hit = clamp((d - 0.15) * 3).toFixed(3);
        put(edgePath, '--draw', draw);
        put(edgePath2, '--draw', draw);
        marks.forEach((m) => put(m, '--hit', hit));
        put(verdict, '--verdict', clamp((d - 0.8) * 5).toFixed(3));
      },
    });
  }, []);

  return (
    <section className="proof" id="prova" aria-labelledby="proofTitle">
      <div className="proof-stage" id="proofBoard" ref={boardRef}>
        <h2 className="proof-title" id="proofTitle">
          <span>Prova,</span> <span>não palpite.</span>
        </h2>
        <LockCanvas />
        <svg className="edge" id="edge" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <path id="edgePath" d="M 0 0" pathLength={1} />
          <path id="edgePath2" d="M 0 0" pathLength={1} />
        </svg>
        <div className="snippet" id="snipA">
          <p className="snippet-tag">
            <span>regra a</span>
            <span>escreve total</span>
          </p>
          <p className="snippet-file">services/pricing/handlers.ts</p>
          <pre>
            <span className="k">bus</span>.on(<span className="s">'order.updated'</span>
            {', (o) => {\n  '}
            <mark>o.total</mark> = o.subtotal * <span className="n">0.9</span>
            {';\n});'}
          </pre>
        </div>
        <div className="snippet" id="snipB">
          <p className="snippet-tag">
            <span>regra b</span>
            <span>escreve total</span>
          </p>
          <p className="snippet-file">services/tax/handlers.ts</p>
          <pre>
            <span className="k">bus</span>.on(<span className="s">'order.updated'</span>
            {', (order) => {\n  '}
            <mark>order.total</mark> = order.subtotal * <span className="n">1.1</span>
            {';\n});'}
          </pre>
        </div>
        <div className="verdict" id="verdict">
          <span className="verdict-icon">
            <span className="sq" />
          </span>
          <div>
            <strong>Escrita dupla em "total"</strong>
            <span>Crítico: quem gravar por último vence.</span>
          </div>
        </div>
      </div>
      <Lede className="proof-lede">
        Cada regra vira um nó usado pelo nosso motor para validar a funcionalidade e garantia desse nó dentro de um todo que é o projeto do usuário.
      </Lede>
      <ul className="proof-facts stagger">
        <li>
          <strong>Sem IA, continua provando.</strong> Ciclos de chamada e colisões não dependem de nenhuma chave configurada.
        </li>
        <li>
          <strong>A IA não muda o fato.</strong> Toda explicação carrega a colisão original; abaixo de 85% de confiança, pede revisão humana.
        </li>
        <li>
          <strong>Seis linguagens.</strong> TypeScript e JavaScript pela árvore sintática; Java, Python, C# e PL/pgSQL por leitura das regras.
        </li>
      </ul>
    </section>
  );
}

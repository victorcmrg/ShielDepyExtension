// Topo: título palavra por palavra, mascote que segue o mouse com os olhos, bola verde em camadas e
// parallax na rolagem.
import { Fragment, useEffect, useRef } from 'react';
import { ThinkingMascot } from '../mascots/ThinkingMascot';
import { throttleMascot } from '../mascots/throttle';
import { clamp, idle, indexChildren, put, reduceMotion } from '../motion';
import { BrandButton } from '../parts';
import { addScrollJob } from '../scroll';

const TITLE = ['Veja', 'a', 'colisão', 'antes', 'do', 'deploy', 'acontecer.'];

// Bola verde do topo: 4 camadas pintadas UMA vez em <canvas> (tinta + recorte da forma + tom) que depois só
// giram, orbitam e respiram por transform (CSS), que roda na GPU sem repintar nada.
const SHAPES = {
  base: 'M982.9 500.0C977.6 539.3 947.3 580.5 924.2 613.7C901.1 646.8 866.4 669.2 844.2 698.7C822.0 728.3 810.5 758.5 790.9 790.9C771.4 823.4 755.8 867.8 727.1 893.4C698.5 918.9 656.9 939.5 619.0 944.2C581.2 949.0 537.2 931.1 500.0 921.8C462.8 912.5 432.4 895.4 396.0 888.3C359.5 881.2 320.8 886.8 281.1 879.1C241.4 871.5 190.2 865.7 157.6 842.4C125.0 819.1 98.0 777.7 85.5 739.3C73.1 700.9 82.4 651.6 82.9 611.8C83.4 571.9 90.2 537.7 88.6 500.0C86.9 462.3 72.3 424.8 73.0 385.6C73.7 346.4 74.0 298.3 92.6 264.8C111.2 231.3 149.8 202.8 184.4 184.4C219.0 165.9 264.8 165.4 300.3 154.1C335.8 142.9 364.1 133.2 397.3 116.9C430.6 100.6 462.3 69.0 500.0 56.1C537.7 43.2 585.5 31.1 623.4 39.5C661.3 47.9 698.5 79.0 727.2 106.5C755.9 134.0 771.7 174.5 795.6 204.4C819.5 234.3 843.8 257.2 870.5 286.1C897.1 315.0 936.8 342.3 955.6 377.9C974.3 413.6 988.1 460.7 982.9 500.0Z',
  mid_a: 'M952.3 500.0C950.6 536.8 929.4 578.5 906.8 609.0C884.2 639.5 844.9 661.4 816.7 682.9C788.5 704.3 760.7 716.5 737.9 737.9C715.0 759.3 701.6 784.5 679.7 811.3C657.8 838.0 636.7 875.8 606.7 898.2C576.8 920.7 536.4 942.9 500.0 946.0C463.6 949.2 420.5 935.6 388.2 917.2C356.0 898.7 329.8 862.8 306.4 835.3C283.1 807.7 268.8 777.1 248.3 751.7C227.7 726.3 206.0 707.5 183.3 682.9C160.6 658.2 130.1 634.4 112.1 603.9C94.1 573.5 77.1 535.1 75.4 500.0C73.7 464.9 86.0 425.0 101.8 393.3C117.6 361.6 147.0 335.0 170.2 309.6C193.3 284.1 218.0 264.8 240.7 240.7C263.4 216.6 281.4 189.3 306.4 164.7C331.5 140.1 358.7 109.1 391.0 93.2C423.3 77.2 464.5 66.0 500.0 69.1C535.5 72.3 574.0 92.2 603.9 112.1C633.9 132.1 656.1 165.0 679.7 188.7C703.3 212.5 720.4 234.4 745.4 254.6C770.5 274.7 801.2 287.3 829.8 309.6C858.4 331.9 896.8 356.5 917.2 388.2C937.6 420.0 954.0 463.2 952.3 500.0Z',
  core: 'M774.8 500.0C770.9 523.1 759.0 546.7 746.8 566.1C734.7 585.6 717.0 601.6 701.8 616.5C686.7 631.5 670.8 642.8 655.9 655.9C641.1 669.0 628.1 681.7 612.6 695.1C597.2 708.4 582.0 724.2 563.3 736.1C544.5 748.1 522.6 761.3 500.0 766.9C477.4 772.6 450.6 774.8 427.7 770.0C404.8 765.1 380.7 752.8 362.6 737.9C344.6 723.1 330.1 700.9 319.3 680.7C308.6 660.5 303.5 637.1 298.2 616.5C292.8 595.9 290.9 576.5 287.0 557.1C283.1 537.7 278.6 520.1 274.8 500.0C270.9 479.9 264.8 459.0 263.9 436.7C262.9 414.5 262.4 388.9 268.8 366.5C275.2 344.1 286.7 319.8 302.4 302.4C318.0 285.0 340.7 270.3 362.6 262.1C384.5 253.9 411.0 252.4 433.9 253.2C456.8 254.0 479.5 261.3 500.0 266.9C520.5 272.6 538.3 280.7 557.1 287.0C575.8 293.3 593.3 298.2 612.6 304.9C631.9 311.6 653.1 316.9 672.9 327.1C692.6 337.4 715.0 349.8 731.2 366.5C747.4 383.3 762.7 405.4 770.0 427.7C777.2 449.9 778.6 476.9 774.8 500.0Z',
  lobe: 'M672.9 500.0C669.1 514.8 661.4 528.7 654.7 541.5C648.0 554.2 640.1 565.1 632.7 576.6C625.3 588.1 618.6 599.0 610.4 610.4C602.2 621.7 594.2 634.2 583.6 644.7C572.9 655.3 560.5 666.7 546.5 673.7C532.6 680.7 515.7 686.1 500.0 686.8C484.3 687.4 466.8 683.8 452.4 677.6C438.0 671.5 424.5 660.5 413.6 649.7C402.6 639.0 394.4 625.5 386.7 613.3C379.0 601.1 373.5 588.8 367.3 576.6C361.0 564.5 354.9 553.2 349.2 540.4C343.5 527.6 336.7 514.5 332.9 500.0C329.1 485.5 325.4 469.0 326.3 453.5C327.2 437.9 331.0 420.5 338.3 406.6C345.5 392.7 357.4 379.4 370.0 370.0C382.5 360.6 398.8 354.4 413.6 350.3C428.3 346.2 444.1 345.8 458.5 345.3C472.9 344.7 486.4 346.1 500.0 346.8C513.6 347.4 526.5 347.8 540.4 349.2C554.3 350.6 569.1 351.3 583.6 355.3C598.0 359.2 614.1 364.3 627.1 372.9C640.2 381.4 653.3 393.4 661.7 406.6C670.1 419.9 675.8 436.8 677.6 452.4C679.5 468.0 676.7 485.2 672.9 500.0Z',
};
// tons feitos com mistura de cor (rápida) em vez de ctx.filter (lento, roda na CPU)
const LAYERS: { cls: string; path: string; alpha: number; zoom: number; off: [number, number]; tint: [GlobalCompositeOperation, string] }[] = [
  { cls: 'hb1', path: SHAPES.base, alpha: 1, zoom: 1, off: [0, 0], tint: ['source-atop', 'veil'] },
  { cls: 'hb2', path: SHAPES.mid_a, alpha: 0.6, zoom: 1.4, off: [-120, -280], tint: ['multiply', 'rgba(20, 110, 55, 0.55)'] },
  { cls: 'hb3', path: SHAPES.core, alpha: 0.42, zoom: 0.8, off: [100, 100], tint: ['screen', 'rgba(255, 255, 255, 0.35)'] },
  { cls: 'hb4', path: SHAPES.lobe, alpha: 0.3, zoom: 1, off: [0, 0], tint: ['source-atop', 'rgba(240, 205, 220, 0.75)'] },
];

function paintBlob(blob: HTMLElement): () => void {
  let cancelled = false;
  const img = new Image();
  img.src = '/brand-texture.webp';
  img
    .decode()
    .then(() => {
      // resolução interna = tamanho na tela × densidade (limitada); a forma é suave, não precisa de mais
      const shown = blob.getBoundingClientRect().width || 1000;
      const res = Math.round(Math.min(Math.max(shown * Math.min(window.devicePixelRatio || 1, 1.25), 300), 1100));
      const k = res / 1000;
      // uma camada por momento ocioso: nada de uma tarefa longa travando o carregamento
      const paint = (i: number) => {
        const L = LAYERS[i];
        if (!L || cancelled) return;
        // o canvas fica dentro de uma div e quem anima é a div: animação aplicada direto num <canvas> o
        // navegador não manda para a GPU (roda no thread principal a cada quadro)
        const layer = document.createElement('div');
        layer.className = 'hb ' + L.cls;
        const cv = document.createElement('canvas');
        cv.width = cv.height = res;
        layer.appendChild(cv);
        const ctx = cv.getContext('2d')!;
        ctx.scale(k, k);
        ctx.clip(new Path2D(L.path));
        const s = 1000 * L.zoom;
        ctx.drawImage(img, (1000 - s) / 2 + L.off[0], (1000 - s) / 2 + L.off[1], s, s);
        ctx.globalCompositeOperation = L.tint[0];
        if (L.tint[1] === 'veil') {
          const g = ctx.createLinearGradient(0, 0, 1000, 200);
          g.addColorStop(0, 'rgba(16, 239, 124, 0.42)');
          g.addColorStop(1, 'rgba(159, 232, 112, 0.3)');
          ctx.fillStyle = g;
        } else ctx.fillStyle = L.tint[1];
        ctx.fillRect(0, 0, 1000, 1000);
        // a transparência da camada vai junto no próprio desenho (sem opacity no CSS)
        if (L.alpha < 1) {
          ctx.globalCompositeOperation = 'destination-in';
          ctx.fillStyle = `rgba(0, 0, 0, ${L.alpha})`;
          ctx.fillRect(0, 0, 1000, 1000);
        }
        blob.appendChild(layer);
        idle(() => paint(i + 1), 200);
      };
      idle(() => paint(0), 200);
    })
    .catch(() => {});
  return () => {
    cancelled = true;
  };
}

export function Hero() {
  const heroRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const copyRef = useRef<HTMLDivElement>(null);
  const mascotRef = useRef<HTMLDivElement>(null);
  const blobRef = useRef<HTMLDivElement>(null);
  const thinkerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const hero = heroRef.current!;
    const copy = copyRef.current!;
    const mascot = mascotRef.current!;
    const thinker = thinkerRef.current!;
    const reduce = reduceMotion();
    const offs: (() => void)[] = [];

    // Entrada do título: cada palavra sobe com um pequeno atraso (o CSS lê --i).
    indexChildren(titleRef.current!, '.w');

    // ---------------- olhos que seguem o mouse ----------------
    const svg = thinker.querySelector('svg');
    const eyes = [thinker.querySelector<SVGGElement>('#eye-left'), thinker.querySelector<SVGGElement>('#eye-right')].filter((e): e is SVGGElement => !!e);
    let usedPointer = false;
    const lay = { heroH: 0, mascotX: 0, mascotW: 0, mascotBottom: 0 };
    function lookAt(x: number, y: number) {
      if (!svg || !eyes.length) return;
      const box = svg.getBoundingClientRect();
      if (!box.width) return;
      const scale = svg.viewBox.baseVal.width / box.width; // px de tela → unidades do desenho
      // lê as duas posições antes de escrever qualquer coisa (ler depois de escrever força o navegador a recalcular)
      const rects = eyes.map((eye) => eye.getBoundingClientRect());
      eyes.forEach((eye, i) => {
        const r = rects[i]!;
        const dx = x - (r.left + r.width / 2);
        const dy = y - (r.top + r.height / 2);
        const dist = Math.hypot(dx, dy) || 1;
        const reach = Math.min(dist / 6, 9); // até ~9px de tela; perto do mascote, menos
        eye.style.transform = `translate(${((dx / dist) * reach * scale).toFixed(1)}px, ${((dy / dist) * reach * scale).toFixed(1)}px)`;
      });
    }
    if (!reduce) {
      const move = (e: PointerEvent) => {
        if (e.pointerType !== 'mouse') return;
        usedPointer = true;
        if (window.scrollY < lay.heroH) lookAt(e.clientX, e.clientY); // olhos só com o topo na tela
      };
      window.addEventListener('pointermove', move, { passive: true });
      offs.push(() => window.removeEventListener('pointermove', move));
    }

    offs.push(
      addScrollJob({
        measure() {
          lay.heroH = hero.offsetHeight;
          if (svg) {
            const b = svg.getBoundingClientRect();
            lay.mascotX = b.left + b.width / 2;
            lay.mascotW = b.width;
            lay.mascotBottom = b.bottom + window.scrollY;
          }
        },
        frame() {
          if (reduce) return;
          const sy = window.scrollY;
          // Topo: o texto sobe e esmaece, o mascote desce um pouco (parallax).
          const p = clamp(sy / (lay.heroH * 0.9));
          put(copy, 'transform', `translateY(${(p * -40).toFixed(1)}px)`);
          put(copy, 'opacity', (1 - p * 0.7).toFixed(3));
          put(mascot, 'transform', `translateY(${(p * 70).toFixed(1)}px) scale(${(1 - p * 0.08).toFixed(4)})`);
          // Toque: sem mouse, o mascote olha pra baixo, pra onde a página vai (só enquanto o topo está na tela).
          if (!usedPointer && svg && sy < lay.heroH) lookAt(lay.mascotX, lay.mascotBottom - sy + 300);
        },
      })
    );

    offs.push(throttleMascot(thinker, 'eQN2'));
    offs.push(paintBlob(blobRef.current!));
    return () => offs.forEach((off) => off());
  }, []);

  return (
    <section className="hero" id="inicio" data-pause ref={heroRef}>
      <div className="hero-light" aria-hidden="true" />
      <div className="hero-inner">
        <div className="hero-copy" id="heroCopy" ref={copyRef}>
          <h1 className="hero-title" id="heroTitle" ref={titleRef}>
            {TITLE.map((w, i) => (
              <Fragment key={i}>
                {i > 0 && ' '}
                <span className={w === 'colisão' ? 'w accent' : 'w'}>{w}</span>
              </Fragment>
            ))}
          </h1>
          <p className="hero-lede">ShielDepy proteje seu código durante e depois da produção, evitando problemas invisíveis e dores de cabeça</p>
          <div className="hero-actions">
            <BrandButton href="#planos" className="magnetic">
              Ver planos
            </BrandButton>
          </div>
          <ul className="hero-where" aria-label="Onde o ShielDepy roda">
            <li>Extensão para VS Code</li>
            <li>Portão no CI</li>
            <li>Leitura do Postgres em produção</li>
          </ul>
        </div>

        <div className="hero-mascot" id="heroMascot" aria-hidden="true" ref={mascotRef}>
          {/* bola verde em camadas: cada camada gira/respira/orbita num ritmo diferente */}
          <div className="hero-blob" id="heroBlob" ref={blobRef} />
          <div className="mascot m-thinking" id="thinker" ref={thinkerRef}>
            <ThinkingMascot />
          </div>
          <div className="mascot-shadow" />
        </div>
      </div>
      <a href="#demo" className="scroll-cue" aria-label="Rolar para a próxima seção">
        <span />
      </a>
    </section>
  );
}

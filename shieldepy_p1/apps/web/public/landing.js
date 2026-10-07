// Landing do ShielDepy. Sem bibliotecas: um laço de rolagem (requestAnimationFrame) que escreve
// variáveis CSS (--p, --sp, --tilt, --draw…) e o CSS faz o resto. Respeita prefers-reduced-motion.
(function () {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (id) => document.getElementById(id);
  const clamp = (n, a = 0, b = 1) => Math.min(Math.max(n, a), b);
  const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
  // Escreve um estilo só se mudou. Os valores vão no elemento que usa o valor (não num pai com muitos
  // filhos): variável CSS num pai obriga o navegador a recalcular o estilo de todo o ramo a cada quadro.
  const put = (el, prop, val) => {
    if (el && el.style.getPropertyValue(prop) !== val) el.style.setProperty(prop, val);
  };

  window.shieldepyTheme.mount();
  $('year').textContent = String(new Date().getFullYear());

  // Entrada do título: cada palavra sobe com um pequeno atraso (o CSS lê --i).
  document.querySelectorAll('#heroTitle .w').forEach((w, i) => w.style.setProperty('--i', String(i)));

  // ---------------- olhos que seguem o mouse ----------------
  const thinker = $('thinker');
  const svg = thinker && thinker.querySelector('svg');
  const eyes = thinker ? [thinker.querySelector('#eye-left'), thinker.querySelector('#eye-right')].filter(Boolean) : [];
  let usedPointer = false;
  function lookAt(x, y) {
    if (!svg || !eyes.length) return;
    const box = svg.getBoundingClientRect();
    if (!box.width) return;
    const scale = svg.viewBox.baseVal.width / box.width; // px de tela → unidades do desenho
    // lê as duas posições antes de escrever qualquer coisa (ler depois de escrever força o navegador a recalcular)
    const rects = eyes.map((eye) => eye.getBoundingClientRect());
    eyes.forEach((eye, i) => {
      const r = rects[i];
      const dx = x - (r.left + r.width / 2);
      const dy = y - (r.top + r.height / 2);
      const dist = Math.hypot(dx, dy) || 1;
      const reach = Math.min(dist / 6, 9); // até ~9px de tela; perto do mascote, menos
      eye.style.transform = `translate(${((dx / dist) * reach * scale).toFixed(1)}px, ${((dy / dist) * reach * scale).toFixed(1)}px)`;
    });
  }

  // posições em coordenadas do documento (preenchidas por measureLayout)
  const LAY = { heroH: 0, storyTop: 0, storyH: 0, tiltTop: 0, boardTop: 0, boardH: 0, stageTop: 0, mascotX: 0, mascotW: 0, mascotBottom: 0 };

  // ---------------- mascotes a 20 quadros por segundo ----------------
  // A animação original (SVGator → CSS) mexe em caminhos e grupos do SVG: roda no thread principal e refaz o
  // layout do desenho a cada quadro. Para um personagem em loop lento, 20/s basta. As animações ficam pausadas
  // e um timer (não requestAnimationFrame: ele faria o navegador montar 60 quadros/s e arrastaria junto todas as
  // outras animações da página) avança o relógio delas, só enquanto o mascote está na tela.
  function throttleMascot(root, prefix) {
    if (!root || reduce || !root.getAnimations) return;
    const anims = root.getAnimations({ subtree: true }).filter((a) => (a.animationName || '').startsWith(prefix));
    if (!anims.length) return;
    anims.forEach((a) => a.pause());
    const STEP = 50;
    let timer = 0;
    let t = 0;
    let last = 0;
    const tick = () => {
      const now = performance.now();
      t += Math.min(now - last, 200);
      last = now;
      anims.forEach((a) => (a.currentTime = t));
    };
    const setOn = (on) => {
      if (on && !timer) {
        last = performance.now();
        timer = setInterval(tick, STEP);
      } else if (!on && timer) {
        clearInterval(timer);
        timer = 0;
      }
    };
    let vis = false;
    new IntersectionObserver((entries) => {
      vis = entries[0].isIntersecting;
      setOn(vis && !document.hidden);
    }).observe(root);
    document.addEventListener('visibilitychange', () => setOn(vis && !document.hidden));
  }
  throttleMascot(thinker, 'eQN2');
  throttleMascot(document.querySelector('.m-flowing'), 'eYMl');

  // ---------------- vidro líquido ----------------
  // Para cada peça .lg, um mapa de deslocamento do tamanho exato dela: perto da borda o fundo é puxado para
  // dentro (como a borda grossa de uma lente), com os canais R/G/B deslocados em escalas um pouco diferentes.
  // backdrop-filter com url() só funciona no Chromium; nos outros fica o desfoque do CSS.
  const glassDefs = $('glassDefs');
  const brands = (navigator.userAgentData && navigator.userAgentData.brands) || [];
  const liquid = !reduce && !!glassDefs && brands.some((b) => /Chromium/i.test(b.brand));
  const GLASS = {
    card: { bezel: 22, scale: 40 },
  };
  const mapCache = new Map();
  function glassMap(w, h, r, bezel) {
    const key = `${w}x${h}x${r}x${bezel}`;
    if (mapCache.has(key)) return mapCache.get(key);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(w, h);
    const d = img.data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        const cx = px < r ? r : px > w - r ? w - r : px;
        const cy = py < r ? r : py > h - r ? h - r : py;
        let dist;
        let nx = 0;
        let ny = 0;
        if (cx !== px && cy !== py) {
          const dx = px - cx;
          const dy = py - cy;
          const len = Math.hypot(dx, dy) || 1;
          dist = r - len;
          nx = dx / len;
          ny = dy / len;
        } else {
          dist = Math.min(px, w - px, py, h - py);
          if (dist === px) nx = -1;
          else if (dist === w - px) nx = 1;
          else if (dist === py) ny = -1;
          else ny = 1;
        }
        const k = dist >= bezel ? 0 : Math.pow(1 - Math.max(dist, 0) / bezel, 2);
        const i = (y * w + x) * 4;
        d[i] = 128 - nx * k * 127;
        d[i + 1] = 128 - ny * k * 127;
        d[i + 2] = 128;
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const url = c.toDataURL();
    mapCache.set(key, url);
    return url;
  }
  const NS = 'http://www.w3.org/2000/svg';
  function svgEl(name, attrs) {
    const el = document.createElementNS(NS, name);
    for (const k in attrs) el.setAttribute(k, String(attrs[k]));
    return el;
  }
  function updateGlass(el, idx) {
    const w = Math.round(el.offsetWidth);
    const h = Math.round(el.offsetHeight);
    if (w < 4 || h < 4) return;
    const cfg = GLASS[el.dataset.lg] || GLASS.card;
    const r = Math.min(parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0, h / 2, w / 2);
    const bezel = Math.min(cfg.bezel, h / 2, w / 2);
    const sig = `${w}x${h}x${r}`;
    if (el.dataset.lgSig === sig) return;
    el.dataset.lgSig = sig;
    const id = `lg-${idx}`;
    let f = document.getElementById(id);
    if (!f) {
      f = svgEl('filter', { id, x: 0, y: 0, filterUnits: 'userSpaceOnUse', primitiveUnits: 'userSpaceOnUse', 'color-interpolation-filters': 'sRGB' });
      glassDefs.appendChild(f);
    }
    f.setAttribute('width', w);
    f.setAttribute('height', h);
    const parts = [
      // o mapa é suave: gerado em meia resolução (¼ dos pixels) e esticado pelo próprio filtro
      svgEl('feImage', { href: glassMap(Math.ceil(w / 2), Math.ceil(h / 2), Math.round(r / 2), bezel / 2), x: 0, y: 0, width: w, height: h, preserveAspectRatio: 'none', result: 'map' }),
      svgEl('feDisplacementMap', { in: 'SourceGraphic', in2: 'map', scale: cfg.scale, xChannelSelector: 'R', yChannelSelector: 'G' }),
    ];
    f.replaceChildren(...parts);
    el.style.setProperty('--lg-filter', `url(#${id})`);
    el.classList.add('lg-ready');
  }
  const glassEls = Array.from(document.querySelectorAll('.lg'));
  // A refração (filtro SVG atrás do vidro) é refeita a cada quadro quando o que está atrás se mexe. Medido: no
  // menu (por cima da bola girando, do vídeo, da rolagem) ela sozinha ocupava mais da metade da GPU. Por isso só
  // fica nas peças com fundo parado; o menu, as bolhas e o player ficam com o vidro desfocado + borda + reflexo.
  const refractEls = glassEls.filter((el) => el.dataset.lg === 'card');
  if (liquid && refractEls.length) {
    document.documentElement.classList.add('lg-on');
    // cada peça só ganha o mapa quando aparece (perto da tela), num momento ocioso
    const idleCb = window.requestIdleCallback || ((f) => setTimeout(f, 16));
    const dirty = new Set();
    const near = new Set();
    let glassQueued = false;
    const flush = () => {
      glassQueued = false;
      dirty.forEach((el) => {
        if (!near.has(el)) return;
        updateGlass(el, refractEls.indexOf(el));
        dirty.delete(el);
      });
    };
    const queue = () => {
      if (glassQueued) return;
      glassQueued = true;
      idleCb(flush, { timeout: 150 });
    };
    const ro = new ResizeObserver((entries) => {
      entries.forEach((e) => dirty.add(e.target));
      queue();
    });
    const vis = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => (e.isIntersecting ? near.add(e.target) : near.delete(e.target)));
        queue();
      },
      { rootMargin: '300px 0px' }
    );
    refractEls.forEach((el) => {
      ro.observe(el);
      vis.observe(el);
    });
  }

  // Brilho do vidro e luzes que seguem o mouse.
  const hero = document.querySelector('.hero');
  let mouse = null;
  let glintQueued = false;
  function glint() {
    glintQueued = false;
    if (!mouse) return;
    const rects = glassEls.map((el) => el.getBoundingClientRect());
    glassEls.forEach((el, i) => {
      const r = rects[i];
      if (r.bottom < -200 || r.top > window.innerHeight + 200) return;
      el.style.setProperty('--gx', (mouse.x - r.left).toFixed(0) + 'px');
      el.style.setProperty('--gy', (mouse.y - r.top).toFixed(0) + 'px');
    });
  }
  if (!reduce) {
    window.addEventListener(
      'pointermove',
      (e) => {
        if (e.pointerType !== 'mouse') return;
        usedPointer = true;
        mouse = { x: e.clientX, y: e.clientY };
        if (window.scrollY < LAY.heroH) lookAt(e.clientX, e.clientY); // olhos só com o topo na tela
        if (!glintQueued) {
          glintQueued = true;
          requestAnimationFrame(glint);
        }
      },
      { passive: true }
    );
    // Cartões com luz: um halo verde acompanha o cursor por dentro do cartão.
    document.querySelectorAll('.spot').forEach((c) => {
      c.addEventListener('pointermove', (e) => {
        const r = c.getBoundingClientRect();
        c.style.setProperty('--mx', (e.clientX - r.left).toFixed(0) + 'px');
        c.style.setProperty('--my', (e.clientY - r.top).toFixed(0) + 'px');
      });
    });
  }


  // ---------------- bola verde do topo ----------------
  // As 4 camadas são pintadas UMA vez em <canvas> (tinta + recorte da forma + tom) e depois só giram,
  // orbitam e respiram por transform (CSS), que roda na GPU sem repintar nada.
  const heroBlob = $('heroBlob');
  if (heroBlob) {
    const SHAPES = {"base": "M982.9 500.0C977.6 539.3 947.3 580.5 924.2 613.7C901.1 646.8 866.4 669.2 844.2 698.7C822.0 728.3 810.5 758.5 790.9 790.9C771.4 823.4 755.8 867.8 727.1 893.4C698.5 918.9 656.9 939.5 619.0 944.2C581.2 949.0 537.2 931.1 500.0 921.8C462.8 912.5 432.4 895.4 396.0 888.3C359.5 881.2 320.8 886.8 281.1 879.1C241.4 871.5 190.2 865.7 157.6 842.4C125.0 819.1 98.0 777.7 85.5 739.3C73.1 700.9 82.4 651.6 82.9 611.8C83.4 571.9 90.2 537.7 88.6 500.0C86.9 462.3 72.3 424.8 73.0 385.6C73.7 346.4 74.0 298.3 92.6 264.8C111.2 231.3 149.8 202.8 184.4 184.4C219.0 165.9 264.8 165.4 300.3 154.1C335.8 142.9 364.1 133.2 397.3 116.9C430.6 100.6 462.3 69.0 500.0 56.1C537.7 43.2 585.5 31.1 623.4 39.5C661.3 47.9 698.5 79.0 727.2 106.5C755.9 134.0 771.7 174.5 795.6 204.4C819.5 234.3 843.8 257.2 870.5 286.1C897.1 315.0 936.8 342.3 955.6 377.9C974.3 413.6 988.1 460.7 982.9 500.0Z", "mid_a": "M952.3 500.0C950.6 536.8 929.4 578.5 906.8 609.0C884.2 639.5 844.9 661.4 816.7 682.9C788.5 704.3 760.7 716.5 737.9 737.9C715.0 759.3 701.6 784.5 679.7 811.3C657.8 838.0 636.7 875.8 606.7 898.2C576.8 920.7 536.4 942.9 500.0 946.0C463.6 949.2 420.5 935.6 388.2 917.2C356.0 898.7 329.8 862.8 306.4 835.3C283.1 807.7 268.8 777.1 248.3 751.7C227.7 726.3 206.0 707.5 183.3 682.9C160.6 658.2 130.1 634.4 112.1 603.9C94.1 573.5 77.1 535.1 75.4 500.0C73.7 464.9 86.0 425.0 101.8 393.3C117.6 361.6 147.0 335.0 170.2 309.6C193.3 284.1 218.0 264.8 240.7 240.7C263.4 216.6 281.4 189.3 306.4 164.7C331.5 140.1 358.7 109.1 391.0 93.2C423.3 77.2 464.5 66.0 500.0 69.1C535.5 72.3 574.0 92.2 603.9 112.1C633.9 132.1 656.1 165.0 679.7 188.7C703.3 212.5 720.4 234.4 745.4 254.6C770.5 274.7 801.2 287.3 829.8 309.6C858.4 331.9 896.8 356.5 917.2 388.2C937.6 420.0 954.0 463.2 952.3 500.0Z", "core": "M774.8 500.0C770.9 523.1 759.0 546.7 746.8 566.1C734.7 585.6 717.0 601.6 701.8 616.5C686.7 631.5 670.8 642.8 655.9 655.9C641.1 669.0 628.1 681.7 612.6 695.1C597.2 708.4 582.0 724.2 563.3 736.1C544.5 748.1 522.6 761.3 500.0 766.9C477.4 772.6 450.6 774.8 427.7 770.0C404.8 765.1 380.7 752.8 362.6 737.9C344.6 723.1 330.1 700.9 319.3 680.7C308.6 660.5 303.5 637.1 298.2 616.5C292.8 595.9 290.9 576.5 287.0 557.1C283.1 537.7 278.6 520.1 274.8 500.0C270.9 479.9 264.8 459.0 263.9 436.7C262.9 414.5 262.4 388.9 268.8 366.5C275.2 344.1 286.7 319.8 302.4 302.4C318.0 285.0 340.7 270.3 362.6 262.1C384.5 253.9 411.0 252.4 433.9 253.2C456.8 254.0 479.5 261.3 500.0 266.9C520.5 272.6 538.3 280.7 557.1 287.0C575.8 293.3 593.3 298.2 612.6 304.9C631.9 311.6 653.1 316.9 672.9 327.1C692.6 337.4 715.0 349.8 731.2 366.5C747.4 383.3 762.7 405.4 770.0 427.7C777.2 449.9 778.6 476.9 774.8 500.0Z", "lobe": "M672.9 500.0C669.1 514.8 661.4 528.7 654.7 541.5C648.0 554.2 640.1 565.1 632.7 576.6C625.3 588.1 618.6 599.0 610.4 610.4C602.2 621.7 594.2 634.2 583.6 644.7C572.9 655.3 560.5 666.7 546.5 673.7C532.6 680.7 515.7 686.1 500.0 686.8C484.3 687.4 466.8 683.8 452.4 677.6C438.0 671.5 424.5 660.5 413.6 649.7C402.6 639.0 394.4 625.5 386.7 613.3C379.0 601.1 373.5 588.8 367.3 576.6C361.0 564.5 354.9 553.2 349.2 540.4C343.5 527.6 336.7 514.5 332.9 500.0C329.1 485.5 325.4 469.0 326.3 453.5C327.2 437.9 331.0 420.5 338.3 406.6C345.5 392.7 357.4 379.4 370.0 370.0C382.5 360.6 398.8 354.4 413.6 350.3C428.3 346.2 444.1 345.8 458.5 345.3C472.9 344.7 486.4 346.1 500.0 346.8C513.6 347.4 526.5 347.8 540.4 349.2C554.3 350.6 569.1 351.3 583.6 355.3C598.0 359.2 614.1 364.3 627.1 372.9C640.2 381.4 653.3 393.4 661.7 406.6C670.1 419.9 675.8 436.8 677.6 452.4C679.5 468.0 676.7 485.2 672.9 500.0Z"};
    // tons feitos com mistura de cor (rápida) em vez de ctx.filter (lento, roda na CPU)
    const LAYERS = [
      { cls: 'hb1', path: SHAPES.base, alpha: 1, zoom: 1, off: [0, 0], tint: ['source-atop', 'veil'] },
      { cls: 'hb2', path: SHAPES.mid_a, alpha: 0.6, zoom: 1.4, off: [-120, -280], tint: ['multiply', 'rgba(20, 110, 55, 0.55)'] },
      { cls: 'hb3', path: SHAPES.core, alpha: 0.42, zoom: 0.8, off: [100, 100], tint: ['screen', 'rgba(255, 255, 255, 0.35)'] },
      { cls: 'hb4', path: SHAPES.lobe, alpha: 0.3, zoom: 1, off: [0, 0], tint: ['source-atop', 'rgba(240, 205, 220, 0.75)'] },
    ];
    const idle = window.requestIdleCallback || ((f) => setTimeout(f, 16));
    const img = new Image();
    img.src = '/brand-texture.webp';
    img
      .decode()
      .then(() => {
        // resolução interna = tamanho na tela × densidade (limitada); a forma é suave, não precisa de mais
        const shown = heroBlob.getBoundingClientRect().width || 1000;
        const res = Math.round(Math.min(Math.max(shown * Math.min(window.devicePixelRatio || 1, 1.25), 300), 1100));
        const k = res / 1000;
        // uma camada por momento ocioso: nada de uma tarefa longa travando o carregamento
        const paint = (i) => {
          const L = LAYERS[i];
          if (!L) return;
          // o canvas fica dentro de uma div e quem anima é a div: animação aplicada direto num <canvas> o
          // navegador não manda para a GPU (roda no thread principal a cada quadro)
          const layer = document.createElement('div');
          layer.className = 'hb ' + L.cls;
          const cv = document.createElement('canvas');
          cv.width = cv.height = res;
          layer.appendChild(cv);
          const ctx = cv.getContext('2d');
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
          heroBlob.appendChild(layer);
          idle(() => paint(i + 1), { timeout: 200 });
        };
        idle(() => paint(0), { timeout: 200 });
      })
      .catch(() => {});
  }

  // botões verdes: a camada de tinta que desliza é um <span> de verdade (um ::before animado não vai para a GPU)
  document.querySelectorAll('.button-brand').forEach((b) => {
    const t = document.createElement('span');
    t.className = 'btn-tex';
    t.setAttribute('aria-hidden', 'true');
    b.prepend(t);
  });

  // liga os loops contínuos (bola, tinta dos botões) só quando as animações de entrada do topo já acabaram
  const startLoops = () => setTimeout(() => document.documentElement.classList.add('loop-on'), 2200);
  if (document.readyState === 'complete') startLoops();
  else window.addEventListener('load', startLoops, { once: true });

  // ---------------- títulos palavra por palavra + entradas em sequência ----------------
  document.querySelectorAll('.split').forEach((el) => {
    const accent = (el.dataset.accent || '').split('|');
    const words = el.textContent.trim().split(/\s+/);
    el.textContent = '';
    words.forEach((w, i) => {
      const s = document.createElement('span');
      s.className = accent.includes(w) ? 'sw tw-accent' : 'sw';
      s.textContent = w;
      s.style.setProperty('--i', String(i));
      el.append(s, ' ');
    });
  });
  document.querySelectorAll('.stagger').forEach((el) => Array.from(el.children).forEach((c, i) => c.style.setProperty('--i', String(i))));
  document.querySelectorAll('.section-lede, .eyebrow').forEach((el) => el.classList.add('reveal'));
  document.querySelectorAll('.plan.reveal').forEach((el, i) => (el.style.transitionDelay = i * 110 + 'ms'));
  const revealables = document.querySelectorAll('.split, .stagger, .reveal');
  if (reduce || !('IntersectionObserver' in window)) {
    revealables.forEach((el) => el.classList.add('in'));
  } else {
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          e.target.classList.add('in');
          io.unobserve(e.target);
        }),
      { rootMargin: '0px 0px -10% 0px' }
    );
    revealables.forEach((el) => io.observe(el));
  }

  // ---------------- demo: o "vídeo" dentro do monitor 3D ----------------
  // Uma linha do tempo de 26 s. render(t) é determinístico: qualquer instante pode ser desenhado direto,
  // o que permite pausar e arrastar a barra como num player.
  const vid = $('vid');
  const mScreen = $('mScreen');
  const monitor = $('monitor');
  const stage = $('monitorStage');
  const T = 26;
  const CHAPTERS = [
    [0, 'Digitando'],
    [3.4, 'Prova da colisão'],
    [7.2, 'O outro lado'],
    [11.2, 'Correção verificada'],
    [16.4, 'Correção aplicada'],
    [19.8, 'Portão no CI'],
  ];
  const LINE_A = [['order.total', 'v-tok'], [' = order.subtotal * '], ['0.9', 'n'], [';']];
  const LINE_B = [['order.discount'], [' = order.subtotal * '], ['0.1', 'n'], [';']];
  const lenOf = (tokens) => tokens.reduce((n, [t]) => n + t.length, 0);
  const CMD = 'shieldepy report services --fail-on critico';
  const v = {
    typed: $('vTyped'),
    caret: $('vCaret'),
    count: $('vCount'),
    status: $('vStatusText'),
    cmd: $('vCmd'),
    cmdCaret: $('vCmdCaret'),
    apply: $('vApply'),
    play: $('vidPlay'),
    track: $('vidTrack'),
    fill: $('vidFill'),
    chapter: $('vidChapter'),
    time: $('vidTime'),
    chips: [$('chipA'), $('chipB'), $('chipC')],
    cursor: $('vCursor'),
    click: $('vClick'),
    stageBg: document.querySelector('.stage-bg'),
  };
  let lineKey = '';
  function setLine(tokens, name, n) {
    const key = name + n;
    if (key === lineKey) return;
    lineKey = key;
    const frag = document.createDocumentFragment();
    let left = n;
    for (const [text, cls] of tokens) {
      if (left <= 0) break;
      const s = document.createElement('span');
      if (cls) s.className = cls;
      s.textContent = text.slice(0, left);
      left -= s.textContent.length;
      frag.appendChild(s);
    }
    v.typed.replaceChildren(frag);
    pointCache.delete('tok');
  }
  function setText(el, text) {
    if (el.textContent !== text) el.textContent = text;
  }
  // Posição de um elemento dentro do vídeo (em px do desenho, sem as escalas/3D aplicadas por cima).
  function posIn(el) {
    let x = 0;
    let y = 0;
    let n = el;
    while (n && n !== vid) {
      x += n.offsetLeft;
      y += n.offsetTop;
      n = n.offsetParent;
    }
    return n === vid && el.offsetWidth ? { x: x + el.offsetWidth / 2, y: y + el.offsetHeight / 2 } : null;
  }
  const PATH = [
    [0, 'rest'],
    [5.0, 'rest'],
    [6.9, 'tok'],
    [11.0, 'tok'],
    [12.2, 'chat'],
    [15.0, 'chat'],
    [16.2, 'apply'],
    [18.6, 'apply'],
    [20.6, 'rest'],
    [T, 'rest'],
  ];
  const pointCache = new Map();
  function point(name) {
    if (pointCache.has(name)) return pointCache.get(name);
    const p = measurePoint(name);
    // só guarda quando o alvo já existe na tela (o "total" digitado, o botão do chat aberto)
    if (name === 'rest' || name === 'chat' || (name === 'tok' && vid.querySelector('.v-tok')) || (name === 'apply' && v.apply.offsetWidth)) pointCache.set(name, p);
    return p;
  }
  function measurePoint(name) {
    const W = vid.offsetWidth;
    const H = vid.offsetHeight;
    const rest = { x: W * 0.8, y: H * 0.78 };
    if (name === 'tok') {
      const tok = vid.querySelector('.v-tok');
      const p = tok && posIn(tok);
      return p ? { x: p.x + 8, y: p.y + 4 } : rest;
    }
    if (name === 'chat') return { x: W - 170, y: H * 0.5 };
    if (name === 'apply') return posIn(v.apply) || { x: W - 170, y: H * 0.5 };
    return rest;
  }
  function cursorAt(t) {
    let i = 0;
    while (i < PATH.length - 2 && t >= PATH[i + 1][0]) i++;
    const [t0, a] = PATH[i];
    const [t1, b] = PATH[i + 1];
    const k = ease(clamp((t - t0) / (t1 - t0)));
    const p = point(a);
    const q = a === b ? p : point(b);
    return { x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k };
  }
  const fmtTime = (s) => `0:${String(Math.floor(s)).padStart(2, '0')}`;

  function render(t) {
    if (!vid) return;
    const on = (cls, cond) => vid.classList.toggle(cls, !!cond);
    const fixed = t >= 16.9;
    if (fixed) setLine(LINE_B, 'B', lenOf(LINE_B));
    else setLine(LINE_A, 'A', Math.floor(clamp((t - 0.8) / 2.6) * lenOf(LINE_A)));
    v.caret.classList.toggle('on', t >= 0.4 && t < 3.6);
    const analyzing = t >= 3.5 && t < 4.5;
    const issue = t >= 4.5 && t < 16.9;
    on('s-analyzing', analyzing);
    on('s-issue', issue);
    on('s-hover', t >= 7.3 && t < 11.0);
    on('s-chat', t >= 11.3 && t < 19.8);
    on('s-msg1', t >= 11.9);
    on('s-dots', t >= 12.5 && t < 13.7);
    on('s-msg2', t >= 13.7);
    on('s-ok', t >= 14.4);
    on('s-apply', t >= 15.0);
    on('s-press', t >= 16.4 && t < 16.7);
    on('s-click', t >= 16.4 && t < 17.2);
    on('s-fixed', fixed);
    on('s-toast', t >= 17.3 && t < 20.2);
    on('s-term', t >= 19.9);
    setText(v.cmd, CMD.slice(0, Math.floor(clamp((t - 20.5) / 1.8) * CMD.length)));
    v.cmdCaret.classList.toggle('on', t >= 19.9 && t < 22.6);
    on('s-out1', t >= 22.7);
    on('s-out2', t >= 23.3);
    on('s-fade', t >= 25.4);
    setText(v.count, issue ? '1' : '0');
    setText(v.status, analyzing ? 'ShielDepy: analisando…' : issue ? 'ShielDepy: 1 colisão importante' : 'ShielDepy: protegido');
    const c = cursorAt(t);
    const cx = c.x.toFixed(1) + 'px';
    const cy = c.y.toFixed(1) + 'px';
    put(v.cursor, '--cx', cx);
    put(v.cursor, '--cy', cy);
    put(v.click, '--cx', cx);
    put(v.click, '--cy', cy);
    // as bolhas de vidro em volta acendem no momento delas
    v.chips[0].classList.toggle('lit', t >= 4.5 && t < 11.2);
    v.chips[1].classList.toggle('lit', t >= 14.4 && t < 19.8);
    v.chips[2].classList.toggle('lit', t >= 23.3);
    // player
    put(v.fill, '--vp', (t / T).toFixed(3));
    setText(v.time, fmtTime(t));
    let ch = CHAPTERS[0][1];
    for (const [at, name] of CHAPTERS) if (t >= at) ch = name;
    setText(v.chapter, ch);
    const now = String(Math.floor(t));
    if (v.track.getAttribute('aria-valuenow') !== now) v.track.setAttribute('aria-valuenow', now);
  }

  // O vídeo é desenhado num tamanho fixo e escalado para caber na tela do monitor.
  function fitVideo() {
    if (!vid || !mScreen) return;
    const w = mScreen.clientWidth;
    const compact = w < 520;
    vid.classList.toggle('compact', compact);
    vid.style.setProperty('--vs', (w / (compact ? 560 : 1000)).toFixed(4));
    lineKey = '';
    pointCache.clear();
  }

  let vt = reduce ? 14.8 : 0;
  let playing = !reduce;
  let running = false;
  let visible = false;
  let last = 0;
  // o monitor só se mexe na entrada (rolagem): chega inclinado e endireita; depois fica fixo (não segue o mouse)
  const tilt = { rx: 26, ty: 40, ms: 0.86, e: 0 };

  function stageTargets() {
    const vh = window.innerHeight;
    const e = reduce ? 1 : clamp((vh - (LAY.stageTop - window.scrollY)) / (vh * 0.85));
    return {
      e,
      rx: (1 - e) * 26,
      ty: (1 - e) * 50,
      ms: 0.84 + e * 0.16,
    };
  }
  function applyTilt(dt, g) {
    const k = reduce ? 1 : Math.min(1, dt * 7);
    for (const key in g) tilt[key] += (g[key] - tilt[key]) * k;
    // inclinação de entrada numa camada só; reto = sem transform nenhum
    const flat = tilt.rx < 0.05 && tilt.ty < 0.3 && tilt.ms > 0.9995;
    monitorFlat = flat;
    monitor.classList.toggle('flat', flat);
    put(monitor, 'transform', flat ? 'none' : `perspective(1800px) translateY(${tilt.ty.toFixed(1)}px) rotateX(${tilt.rx.toFixed(2)}deg) scale(${tilt.ms.toFixed(4)})`);
    const e = tilt.e.toFixed(2);
    for (const chip of v.chips) put(chip, '--e', e);
    put(v.stageBg, '--e', e);
  }
  // O vídeo só anda com o monitor já reto. Enquanto ele entra inclinado, a tela fica parada no primeiro quadro:
  // assim a GPU só reposiciona uma imagem pronta, em vez de redesenhar a tela inclinada a cada quadro.
  let monitorFlat = false;
  function loop(now) {
    if (!running) return;
    // o carimbo do rAF pode ser um pouco anterior ao performance.now() guardado ao ligar o laço
    const dt = clamp((now - last) / 1000, 0, 0.1);
    last = now;
    if (playing && monitorFlat) vt = (vt + dt) % T;
    const g = stageTargets();
    render(vt);
    applyTilt(dt, g);
    requestAnimationFrame(loop);
  }
  function setRunning(should) {
    if (should === running) return;
    running = should;
    if (running) {
      last = performance.now();
      requestAnimationFrame(loop);
    }
  }
  function setPlaying(p) {
    playing = p;
    v.play.classList.toggle('paused', !p);
    v.play.setAttribute('aria-label', p ? 'Pausar a demo' : 'Reproduzir a demo');
  }

  if (vid && monitor && stage) {
    fitVideo();
    new ResizeObserver(fitVideo).observe(mScreen);
    CHAPTERS.slice(1).forEach(([at]) => {
      const tick = document.createElement('i');
      tick.className = 'vid-tick';
      tick.style.setProperty('--at', (at / T).toFixed(4));
      v.track.appendChild(tick);
    });
    setPlaying(playing);
    render(vt);
    LAY.stageTop = stage.getBoundingClientRect().top + window.scrollY;
    applyTilt(1, stageTargets());
    v.play.addEventListener('click', () => setPlaying(!playing));
    // arrastar/clicar na barra leva a demo para aquele instante
    const seek = (e) => {
      const r = v.track.getBoundingClientRect();
      vt = clamp((e.clientX - r.left) / r.width) * (T - 0.01);
      render(vt);
    };
    v.track.addEventListener('pointerdown', (e) => {
      v.track.setPointerCapture(e.pointerId);
      seek(e);
      const move = (ev) => seek(ev);
      const up = () => {
        v.track.removeEventListener('pointermove', move);
        v.track.removeEventListener('pointerup', up);
      };
      v.track.addEventListener('pointermove', move);
      v.track.addEventListener('pointerup', up);
    });
    v.track.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        vt = clamp(vt + (e.key === 'ArrowRight' ? 2 : -2), 0, T - 0.01);
        render(vt);
        e.preventDefault();
      } else if (e.key === ' ' || e.key === 'Enter') {
        setPlaying(!playing);
        e.preventDefault();
      }
    });
    // só anima quando a demo está na tela e a aba está visível; na primeira vez, começa do zero
    let started = reduce;
    // observa o próprio monitor (a seção começa colada no topo e "estaria visível" desde o carregamento)
    new IntersectionObserver((entries) => {
      visible = entries[0].isIntersecting;
      setRunning(visible && !document.hidden);
    }).observe(stage);
    new IntersectionObserver((entries) => {
      if (started || !entries[0].isIntersecting) return;
      started = true;
      vt = 0;
    }, { threshold: 0.35 }).observe(stage);
    document.addEventListener('visibilitychange', () => setRunning(visible && !document.hidden));
  }

  // ---------------- painel: cada item da lista acende a parte do painel correspondente ----------------
  const points = Array.from(document.querySelectorAll('#showcasePoints li'));
  const panelEl = $('panelMock');
  function focusPart(li) {
    points.forEach((p) => p.classList.toggle('on', p === li));
    if (li) panelEl.dataset.focus = li.dataset.focus;
    else delete panelEl.dataset.focus;
  }
  points.forEach((li) => {
    li.addEventListener('pointerenter', () => focusPart(li));
    li.addEventListener('pointerleave', () => focusPart(null));
  });

  // ---------------- dia a dia: as animações dos cartões só rodam na tela ----------------
  const bento = $('bento');
  if (bento) {
    if (reduce || !('IntersectionObserver' in window)) bento.classList.toggle('playing', !reduce);
    else new IntersectionObserver((entries) => bento.classList.toggle('playing', entries[0].isIntersecting)).observe(bento);
  }

  // ---------------- seções fora da tela: animações pausadas ----------------
  if ('IntersectionObserver' in window) {
    const pauser = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.target.classList.toggle('paused', !e.isIntersecting)),
      { rootMargin: '-1px 0px' } // só encostar na borda da tela não conta como visível
    );
    document.querySelectorAll('[data-pause]').forEach((el) => pauser.observe(el));
  }

  // ---------------- laço de rolagem ----------------
  const topbar = $('topbar');
  const heroCopy = $('heroCopy');
  const heroMascot = $('heroMascot');
  const story = $('deploy');
  const steps = Array.from(document.querySelectorAll('#storySteps li'));
  const screens = Array.from(document.querySelectorAll('.story-stage .frame'));
  const storyBar = $('storyBar');
  const tiltStage = $('tiltStage');
  const panel = $('panelMock');
  const board = $('proofBoard');
  const edge = $('edge');
  const edgePath = $('edgePath');
  const edgePath2 = $('edgePath2');
  const lockCanvas = $('lockCanvas');
  const marks = board ? board.querySelectorAll('mark') : [];
  const wide = window.matchMedia('(min-width: 901px)');
  let currentStep = -1;
  let counted = false;

  function setStep(i) {
    if (i === currentStep) return;
    currentStep = i;
    steps.forEach((s, k) => s.classList.toggle('active', k === i));
    screens.forEach((f, k) => {
      f.classList.toggle('active', k === i);
      f.classList.toggle('past', k < i);
    });
  }

  /** As duas regras ficam frente a frente, uma de cada lado do cadeado: cada aresta é uma reta que sai da
   *  borda do trecho, na altura do "total", e some atrás do corpo do cadeado. */
  function layoutEdge() {
    if (!board || marks.length < 2 || !edgePath2) return;
    const b = board.getBoundingClientRect();
    const f = (n) => n.toFixed(1);
    edge.setAttribute('viewBox', `0 0 ${Math.round(b.width)} ${Math.round(b.height)}`);
    const lock = lockCanvas && lockCanvas.offsetWidth ? lockCanvas.getBoundingClientRect() : null;
    const cx = lock ? lock.left + lock.width / 2 - b.left : b.width / 2;
    const sa = marks[0].closest('.snippet').getBoundingClientRect();
    const sb = marks[1].closest('.snippet').getBoundingClientRect();
    const a = marks[0].getBoundingClientRect();
    const c = marks[1].getBoundingClientRect();
    const ay = a.top + a.height / 2 - b.top;
    const by = c.top + c.height / 2 - b.top;
    edgePath.setAttribute('d', `M ${f(sa.right - b.left)} ${f(ay)} L ${f(cx)} ${f(ay)}`);
    edgePath2.setAttribute('d', `M ${f(sb.left - b.left)} ${f(by)} L ${f(cx)} ${f(by)}`);
  }

  function countUp() {
    if (counted || !panel) return;
    counted = true;
    panel.querySelectorAll('[data-count]').forEach((el) => {
      const to = Number(el.dataset.count);
      if (reduce) {
        el.textContent = String(to);
        return;
      }
      const t0 = performance.now();
      const tick = (now) => {
        const k = clamp((now - t0) / 900);
        el.textContent = String(Math.round(to * (1 - Math.pow(1 - k, 3))));
        if (k < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  function frame() {
    // posições vêm do cache (measureLayout): aqui só contas com scrollY, nenhuma leitura de layout
    const vh = window.innerHeight;
    const sy = window.scrollY;
    const heroH = LAY.heroH;
    // sem mouse, o mascote olha para baixo; só enquanto o topo está na tela
    const mascotBox = !usedPointer && !reduce && svg && sy < LAY.heroH ? { left: LAY.mascotX - LAY.mascotW / 2, width: LAY.mascotW, bottom: LAY.mascotBottom - sy } : null;
    const storyTop = LAY.storyTop - sy;
    const storyH = LAY.storyH;
    const tiltTop = LAY.tiltTop - sy;
    const boardRect = board ? { top: LAY.boardTop - sy, height: LAY.boardH } : null;

    // 2) escritas
    topbar.classList.toggle('scrolled', sy > 40);
    // Topo: o texto sobe e esmaece, o mascote desce um pouco (parallax).
    if (hero && !reduce) {
      const p = clamp(sy / (heroH * 0.9));
      put(heroCopy, 'transform', `translateY(${(p * -40).toFixed(1)}px)`);
      put(heroCopy, 'opacity', (1 - p * 0.7).toFixed(3));
      put(heroMascot, 'transform', `translateY(${(p * 70).toFixed(1)}px) scale(${(1 - p * 0.08).toFixed(4)})`);
    }
    // Toque: sem mouse, o mascote olha pra baixo, pra onde a página vai.
    if (mascotBox) lookAt(mascotBox.left + mascotBox.width / 2, mascotBox.bottom + 300);
    // Antes e depois do deploy: a seção gruda e os 4 momentos se alternam com a rolagem.
    if (story && wide.matches) {
      const sp = clamp(-storyTop / (storyH - vh));
      put(storyBar, '--sp', sp.toFixed(3));
      setStep(Math.min(steps.length - 1, Math.floor(sp * steps.length * 0.999)));
    }
    // Cartão do painel: entra inclinado e endireita ao chegar perto do meio da tela.
    if (tiltStage && panel) {
      const t = clamp((vh - tiltTop) / (vh * 0.75));
      const tl = reduce ? 0 : (1 - t) * 32;
      const lf = reduce ? 0 : (1 - t) * 60;
      const sc = reduce ? 1 : 0.9 + t * 0.1;
      put(panel, 'transform', `rotateX(${tl.toFixed(2)}deg) translateY(${lf.toFixed(1)}px) scale(${sc.toFixed(3)})`);
      put(panel, 'box-shadow', `0 60px 120px -60px rgba(0, 0, 0, 0.75), 0 0 0 1px rgba(16, 239, 124, ${(t * 0.25).toFixed(3)})`);
      if (t > 0.6) countUp();
    }
    // A prova: as arestas vão sendo desenhadas; no fim aparece o veredito.
    if (boardRect) {
      const d = reduce ? 1 : clamp((vh * 0.85 - boardRect.top) / (boardRect.height * 0.9));
      const draw = d.toFixed(3);
      const hit = clamp((d - 0.15) * 3).toFixed(3);
      put(edgePath, '--draw', draw);
      if (edgePath2) put(edgePath2, '--draw', draw);
      marks.forEach((m) => put(m, '--hit', hit));
      put($('verdict'), '--verdict', clamp((d - 0.8) * 5).toFixed(3));
    }
  }

  let queued = false;
  // Posições das seções medidas UMA vez (e de novo só quando algo muda de tamanho). Medir a cada quadro
  // (getBoundingClientRect) logo depois de outros scripts escreverem estilos obriga o navegador a recalcular tudo.
  function measureLayout() {
    const sy = window.scrollY;
    const top = (el) => (el ? el.getBoundingClientRect().top + sy : 0);
    LAY.heroH = hero ? hero.offsetHeight : 0;
    LAY.storyTop = top(story);
    LAY.storyH = story ? story.offsetHeight : 0;
    LAY.tiltTop = top(tiltStage);
    LAY.boardTop = top(board);
    LAY.boardH = board ? board.offsetHeight : 0;
    LAY.stageTop = top(stage);
    if (svg) {
      const b = svg.getBoundingClientRect();
      LAY.mascotX = b.left + b.width / 2;
      LAY.mascotW = b.width;
      LAY.mascotBottom = b.bottom + sy;
    }
  }
  function onScroll() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      frame();
      if (mouse && !glintQueued) {
        glintQueued = true;
        requestAnimationFrame(glint);
      }
    });
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  let relayoutQueued = false;
  const relayout = () => {
    if (relayoutQueued) return;
    relayoutQueued = true;
    requestAnimationFrame(() => {
      relayoutQueued = false;
      measureLayout();
      layoutEdge();
      frame();
    });
  };
  window.addEventListener('resize', relayout);
  // a altura da página muda (fontes, seções que só renderizam perto da tela): mede de novo
  new ResizeObserver(relayout).observe(document.body);
  measureLayout();
  layoutEdge();
  frame();
  if (!wide.matches) setStep(0);
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      measureLayout();
      layoutEdge();
      frame();
      lineKey = '';
    });
  }

  // Clicar num passo leva a rolagem até ele.
  steps.forEach((s, i) => {
    s.addEventListener('click', () => {
      if (!wide.matches) return;
      const total = story.offsetHeight - window.innerHeight;
      window.scrollTo({ top: story.offsetTop + total * ((i + 0.5) / steps.length), behavior: reduce ? 'auto' : 'smooth' });
    });
  });

  // ---------------- planos: mensal/anual ----------------
  const billing = $('billing');
  const pill = $('billingPill');
  const billButtons = billing ? Array.from(billing.querySelectorAll('button')) : [];
  function placePill(btn) {
    if (!btn) return;
    pill.style.setProperty('--x', btn.offsetLeft + 'px');
    pill.style.setProperty('--w', btn.offsetWidth + 'px');
  }
  billButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.billing;
      if (btn.getAttribute('aria-pressed') === 'true') return;
      billButtons.forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      placePill(btn);
      if (!reduce) {
        pill.classList.remove('moving');
        void pill.offsetWidth;
        pill.classList.add('moving');
      }
      document.querySelectorAll('[data-' + mode + ']').forEach((el) => {
        el.textContent = el.getAttribute('data-' + mode);
        if (el.tagName === 'STRONG' && !reduce) {
          el.classList.remove('flip');
          void el.offsetWidth;
          el.classList.add('flip');
        }
      });
    });
  });
  const pressed = () => billButtons.find((b) => b.getAttribute('aria-pressed') === 'true');
  placePill(pressed());
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => placePill(pressed()));
})();

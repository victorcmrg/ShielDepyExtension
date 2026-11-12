// A encenação do "Entrar" (decisão 0039, segunda versão): o roteiro anda na ordem ditada, os
// cursores terminam onde a tela final está, e a física deita as peças no chão.
import { describe, expect, it } from 'vitest';
import { kickAround, makeBody, rng, stepBody } from '../src/portal/pages/entrar/physics';
import {
  T,
  balloonSpots,
  cursorTracks,
  cx,
  cy,
  depthScale,
  introCamera,
  meetingPoints,
  palette,
  progressAt,
  rebuildCamera,
  sample,
  sampleCam,
  titleText,
  TITLE,
  TITLE_TYPO,
  depthPx,
  within,
  spawner,
  lens,
  logoHandle,
  orbit,
  typingTaps,
  BUMP_WINDOWS,
  CHAOS,
  spawner2,
  graphPanel,
  devtools,
  type Layout,
  type Rect,
} from '../src/portal/pages/entrar/script';

const r = (l: number, t: number, w: number, h: number): Rect => ({ l, t, r: l + w, b: t + h });
// uma tela de 1088×690 com o cartão de login de 384 px no meio (como o portal desenha)
const L: Layout = {
  vw: 1088,
  vh: 690,
  card: r(-192, -200, 384, 380),
  logo: r(-60, -240, 120, 26),
  title: r(-75, -168, 150, 29),
  subtitle: r(-160, -134, 320, 22),
  emailLabel: r(-160, -90, 320, 16),
  email: r(-160, -66, 320, 40),
  passLabel: r(-160, -10, 320, 16),
  pass: r(-160, 14, 320, 40),
  button: r(-160, 70, 320, 46),
  back: r(-192, 202, 384, 20),
};

describe('roteiro do Entrar', () => {
  it('o 404 fica 3 s parado; depois caem o texto, o 0, um 4 e o outro 4, nessa ordem', () => {
    expect(T.NOT_FOUND).toBe(3000);
    expect(T.FALL_TEXT).toBeGreaterThanOrEqual(T.NOT_FOUND);
    expect(T.FALL_0).toBeGreaterThan(T.FALL_TEXT);
    expect(T.FALL_4A).toBeGreaterThan(T.FALL_0);
    expect(T.FALL_4B).toBeGreaterThan(T.FALL_4A);
  });

  it('o balão aparece 3 s depois de a câmera começar a aproximar e carrega por 1 s', () => {
    expect(T.POPUP - T.ZOOM[0]).toBe(3000);
    expect(T.LOADED - T.POPUP - 200).toBe(1000);
    expect(T.SPLIT1[0]).toBeGreaterThanOrEqual(T.LOADED);
    expect(T.SPLIT2[0]).toBeGreaterThan(T.SPLIT1[1]);
  });

  it('os marcos da reconstrução vêm em ordem e cabem antes do fim', () => {
    const order = [T.CAM_BACK[1], T.BOX[0], T.BOX[1], T.GRAB_P2[1], T.LOGO[1], T.SUB[1], T.PALETTE_CLICK, T.PASS[1], T.ERASE[1], T.TYPE1[1], T.BUTTON[1], T.PAINT, T.BACK[1], T.TYPE2[1], T.FONT_PICK, T.HIGH5, T.EXIT[1], T.END];
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThanOrEqual(order[i - 1]!);
  });

  it('a câmera aproxima no começo e volta ao normal antes dos cursores', () => {
    const cam = introCamera(1088, 690);
    expect(sampleCam(cam, T.ZOOM[0]).s).toBe(1);
    expect(sampleCam(cam, T.POPUP).s).toBeGreaterThan(1.3);
    expect(sampleCam(cam, T.SPLIT1[1] + 200).s).toBeLessThan(sampleCam(cam, T.POPUP).s);
    expect(sampleCam(cam, T.SPLIT2[1] + 200).s).toBeLessThan(sampleCam(cam, T.SPLIT1[1] + 200).s);
    expect(sampleCam(cam, T.CAM_BACK[1])).toMatchObject({ s: 1, fx: 0, fy: 0 });
  });

  it('a câmera da reconstrução muda de zoom e termina no normal', () => {
    const cam = rebuildCamera(L);
    const scales = cam.map((k) => k.s);
    expect(Math.min(...scales)).toBeLessThan(1);
    expect(Math.max(...scales)).toBeGreaterThanOrEqual(1.15);
    expect(sampleCam(cam, T.END)).toMatchObject({ s: 1, fx: 0, fy: 0 });
  });

  it('os balões vão para a direita em cima e para a esquerda embaixo', () => {
    const { p0, p1, p2 } = balloonSpots(1088, 690);
    expect(p1.x).toBeGreaterThan(p0.x);
    expect(p1.y).toBeLessThan(p0.y);
    expect(p2.x).toBeLessThan(p0.x);
    expect(p2.y).toBeGreaterThan(p0.y);
  });

  it('A desenha a caixa do canto de cima à direita até o de baixo à esquerda', () => {
    const { a } = cursorTracks(L);
    expect(sample(a.keys, T.BOX[0])).toMatchObject({ x: L.card.r, y: L.card.t });
    expect(sample(a.keys, T.BOX[1])).toMatchObject({ x: L.card.l, y: L.card.b });
    expect(a.press.some((iv) => within(iv, (T.BOX[0] + T.BOX[1]) / 2))).toBe(true);
  });

  it('B chega perto da câmera para puxar os balões', () => {
    const tracks = cursorTracks(L);
    expect(sample(tracks.b.keys, T.GRAB_P1[0]).z).toBeGreaterThan(0.5);
  });

  it('o primeiro cursor entra pela direita, olha em volta, verifica o erro e cria os outros no "+"', () => {
    const tracks = cursorTracks(L);
    const sp = spawner(L);
    expect(tracks.a.born).toBe(T.A_POP);
    expect(tracks.a.enter).toBe(true);
    expect(sample(tracks.a.keys, T.A_POP).x).toBeGreaterThan(L.vw / 2);
    // para (desacelerando) antes de olhar em volta, e a cabeça quase não se mexe enquanto olha
    const lookA = sample(tracks.a.keys, T.LOOK[0]);
    const lookB = sample(tracks.a.keys, T.LOOK[1]);
    expect(Math.hypot(lookA.x - lookB.x, lookA.y - lookB.y)).toBeLessThan(10);
    // pisca rápido e as olhadas são pulos (cada uma fica parada pelo menos 150 ms)
    expect(tracks.a.blinks!.some((b) => within(T.LOOK, b))).toBe(true);
    const looks = tracks.a.looks!;
    for (let i = 1; i < looks.length; i++) expect(looks[i]!.t - looks[i - 1]!.t).toBeGreaterThanOrEqual(150);
    // e clica no cartão para começar a verificação antes de abrir o contador
    expect(tracks.a.clicks).toContain(T.VERIFY_CLICK);
    expect(T.VERIFY_CLICK).toBeLessThan(T.SPAWNER[0]);
    const order = [tracks.b, tracks.c, tracks.d];
    order.forEach((tr, i) => {
      expect(tr.born).toBe([T.SPAWN_B, T.SPAWN_C, T.SPAWN_D][i]);
      expect(sample(tr.keys, tr.born)).toMatchObject({ x: sp.plus.x, y: sp.plus.y });
      // e o espaço entre um nascimento e outro dá para ver (pelo menos 400 ms)
      if (i > 0) expect(tr.born - order[i - 1]!.born).toBeGreaterThanOrEqual(400);
      // A está clicando no "+" quando cada um nasce
      expect(tracks.a.press.some((iv) => within(iv, tr.born))).toBe(true);
    });
    for (const [id, tr] of Object.entries(tracks)) {
      for (let t = id === 'a' ? T.A_ENTER[1] : tr.born; t < tr.gone; t += 40) {
        const p = sample(tr.keys, t);
        expect(Math.abs(p.x)).toBeLessThan(L.vw / 2 + 60);
      }
      // os agentes do caos saem depois de conferir; os outros ficam para o encontro do fim
      if (!CHAOS.includes(id as 'x')) expect(tr.gone).toBeGreaterThan(T.HIGH5);
      expect(tr.gone).toBeLessThanOrEqual(T.END);
    }
  });

  it('a elipse demora mais bem na frente da câmera (o cursor fica ali um instante)', () => {
    const keys = orbit({ t0: 0, t1: 1600, x: 0, y: 0, rx: 300, ry: 80, zMid: 0.8, zAmp: 2.8, from: Math.PI, dir: 1 });
    let front = 0;
    let all = 0;
    for (let t = 0; t <= 1600; t += 4) {
      all++;
      if (sample(keys, t).z > 0.8 + 2.8 * 0.8) front++;
    }
    // sen > 0,8 ocupa ~20% do ângulo; no tempo, bem mais que isso
    expect(front / all).toBeGreaterThan(0.3);
  });

  it('os esbarrões só valem no encontro combinado e no fim (nada de tremer na digitação)', () => {
    const inBump = (t: number) => BUMP_WINDOWS.some((iv) => within(iv, t));
    expect(inBump(T.BUMP)).toBe(true);
    expect(inBump(T.HIGH5)).toBe(true);
    for (let t = T.ERASE[0]; t < T.TYPE2[1]; t += 50) expect(inBump(t)).toBe(false);
  });

  it('B afunda a cada tecla: as letras, os três apagares e a correção', () => {
    const taps = typingTaps();
    expect(taps.length).toBe(TITLE_TYPO.length + 6);
    expect(cursorTracks(L).b.taps).toEqual(taps);
  });

  it('D cria o logo grande e o encolhe pela alça do canto', () => {
    const { d } = cursorTracks(L);
    expect(sample(d.keys, T.LOGO[0] + 350)).toMatchObject(logoHandle(L));
    expect(sample(d.keys, T.LOGO[1])).toMatchObject({ x: L.logo.r, y: L.logo.b });
  });

  it('olho de peixe invertido: nada no meio, cresce e vai para fora perto da borda', () => {
    expect(lens(0, 0, 1000, 700)).toEqual({ dx: 0, dy: 0, k: 1 });
    expect(lens(200, 100, 1000, 700).k).toBe(1);
    const edge = lens(480, 0, 1000, 700);
    expect(edge.k).toBeGreaterThan(1.15);
    expect(edge.dx).toBeGreaterThan(10);
    const corner = lens(-480, 330, 1000, 700);
    expect(corner.dx).toBeLessThan(0);
    expect(corner.dy).toBeGreaterThan(0);
  });

  it('C clica na última cor da paleta, a do fundo', () => {
    const { c } = cursorTracks(L);
    const sw = palette(L).swatches[4]!;
    const p = sample(c.keys, T.PALETTE_CLICK);
    expect(Math.hypot(p.x - sw.x, p.y - sw.y)).toBeLessThan(15);
    expect(c.clicks).toContain(T.PALETTE_CLICK);
  });

  it('D desenha o e-mail e o botão; C desenha a senha ao mesmo tempo', () => {
    const { c, d } = cursorTracks(L);
    expect(sample(d.keys, T.EMAIL[1])).toMatchObject({ x: L.email.r, y: L.email.b });
    expect(sample(c.keys, T.PASS[1])).toMatchObject({ x: L.pass.r, y: L.pass.b });
    expect(sample(d.keys, T.BUTTON[1])).toMatchObject({ x: L.button.r, y: L.button.b });
  });

  it('há trabalho em paralelo: os campos, o título e o apagar se sobrepõem no tempo', () => {
    const overlap = (x: readonly [number, number], y: readonly [number, number]) => x[0] < y[1] && y[0] < x[1];
    expect(overlap(T.EMAIL, T.PASS)).toBe(true);
    expect(overlap(T.ERASE, T.TYPE1)).toBe(true);
    expect(overlap(T.LOGO, T.GRAB_P2)).toBe(true);
    expect(overlap(T.BUTTON, T.CPF)).toBe(true);
    expect(overlap(T.ORBIT_D, T.THINK_A2)).toBe(true);
    expect(T.TYPE1[0]).toBeGreaterThan(T.ERASE[0]); // B digita atrás da borracha de A
  });

  it('B e D fazem uma elipse e passam gigantes na frente da câmera', () => {
    const tracks = cursorTracks(L);
    for (const [tr, iv] of [
      [tracks.b, T.ORBIT_B],
      [tracks.d, T.ORBIT_D],
    ] as const) {
      let zMax = -Infinity;
      let zMin = Infinity;
      for (let t = iv[0]; t <= iv[1]; t += 20) {
        const z = sample(tr.keys, t).z;
        zMax = Math.max(zMax, z);
        zMin = Math.min(zMin, z);
      }
      expect(depthScale(zMax)).toBeGreaterThan(4); // gigante
      expect(depthScale(zMin)).toBeLessThan(0.7); // e lá no fundo, pequeno
    }
  });

  it('os cursores andam em curva contínua: só param onde agarram, soltam ou clicam', () => {
    const { b } = cursorTracks(L);
    const loose = b.keys.filter((key, i) => !key.hold && i > 0 && i < b.keys.length - 1);
    expect(loose.length).toBeGreaterThan(5);
    for (const key of loose) {
      const p0 = sample(b.keys, key.t - 8);
      const p1 = sample(b.keys, key.t + 8);
      expect(Math.hypot(p1.x - p0.x, p1.y - p0.y, (p1.z - p0.z) * 100)).toBeGreaterThan(0.01);
    }
  });

  it('A e D se encontram no esbarrão combinado e os quatro se juntam em cima do cartão', () => {
    const tracks = cursorTracks(L);
    const m = meetingPoints(L);
    const a = sample(tracks.a.keys, T.BUMP);
    const d = sample(tracks.d.keys, T.BUMP);
    expect(a).toMatchObject({ x: m.bump.x, y: m.bump.y });
    expect(d).toMatchObject({ x: m.bump.x, y: m.bump.y });
    for (const tr of [tracks.a, tracks.b, tracks.c, tracks.d]) {
      const p = sample(tr.keys, T.HIGH5);
      expect(Math.hypot(p.x - m.high5.x, p.y - m.high5.y)).toBeLessThan(40);
    }
  });

  it('B digita o título com um erro, para, apaga as três letras e corrige', () => {
    expect(titleText(T.TYPE1[0] - 1)).toBe('');
    const mid = titleText((T.TYPE1[0] + T.TYPE1[1]) / 2);
    expect(mid.length).toBeGreaterThan(2);
    expect(TITLE_TYPO.startsWith(mid)).toBe(true);
    expect(titleText(T.TYPE1[1])).toBe(TITLE_TYPO);
    expect(titleText(T.THINK_B[1])).toBe(TITLE_TYPO); // pensando, sem mexer
    expect(titleText(T.BACKSPACE[1])).toBe(TITLE.slice(0, TITLE.length - 3));
    expect(titleText(T.TYPE2[1])).toBe(TITLE);
    expect(titleText(T.END)).toBe(TITLE);
  });

  it('antes de escolher a cor, apagar o título, pintar o botão e trocar a fonte, alguém para e pensa', () => {
    const tracks = cursorTracks(L);
    const thinking = (t: number) => Object.values(tracks).some((tr) => tr.think.some((iv) => within(iv, t)));
    expect(thinking(T.PALETTE_CLICK - 300)).toBe(true);
    expect(thinking(T.ERASE[0] - 100)).toBe(true);
    expect(thinking(T.BACKSPACE[0] - 100)).toBe(true);
    expect(thinking(T.PAINT - 200)).toBe(true);
    expect(thinking(T.FONT_PICK - 200)).toBe(true);
    // escolher a cor leva mais de 1,5 s desde que a paleta abre
    expect(T.PALETTE_CLICK - T.PALETTE_OPEN).toBeGreaterThan(1500);
  });

  it('a câmera inclina em 3D durante a obra e fica reta no fim', () => {
    const rb = rebuildCamera(L);
    const cam = [...introCamera(1088, 690).filter((k) => k.t < rb[0]!.t), ...rb];
    let tilt = 0;
    for (let t = T.BOX[0]; t < T.HIGH5; t += 50) {
      const c = sampleCam(cam, t);
      tilt = Math.max(tilt, Math.abs(c.rx), Math.abs(c.ry));
    }
    // inclina, mas pouco, e quase não sai do centro: a tela de login fica no meio
    expect(tilt).toBeGreaterThan(2);
    expect(tilt).toBeLessThanOrEqual(4);
    for (let t = T.BOX[0]; t < T.HIGH5; t += 50) {
      const c = sampleCam(cam, t);
      expect(c.s).toBeGreaterThan(0.94);
      expect(c.s).toBeLessThan(1.13);
      expect(Math.abs(c.fx)).toBeLessThan(60);
      expect(Math.abs(c.fy)).toBeLessThan(60);
    }
    expect(sampleCam(cam, T.END)).toMatchObject({ s: 1, rx: 0, ry: 0 });
  });

  it('a profundidade em px dá a mesma escala da perspectiva', () => {
    for (const z of [-1, 0, 1, 3.6]) {
      const px = depthPx(z);
      expect(1100 / (1100 - px)).toBeCloseTo(depthScale(z), 6);
    }
  });

  it('A põe o segundo botão embaixo e cria os dois agentes do caos', () => {
    const tracks = cursorTracks(L);
    const sp2 = spawner2(L);
    expect(T.SPAWNER2[0]).toBeGreaterThan(T.SPAWN_D);
    for (const [tr, at] of [
      [tracks.x, T.SPAWN_X],
      [tracks.y, T.SPAWN_Y],
    ] as const) {
      expect(tr.born).toBe(at);
      expect(sample(tr.keys, at)).toMatchObject(sp2.plus);
      expect(tracks.a.press.some((iv) => within(iv, at))).toBe(true);
    }
    expect(T.SPAWN_Y - T.SPAWN_X).toBeGreaterThanOrEqual(400);
    expect(T.SPAWNER2[1]).toBeLessThan(T.BOX[0]);
  });

  it('X percorre o grafo e para na ligação quebrada /entrar → <Login/>', () => {
    const { x } = cursorTracks(L);
    const g = graphPanel(L);
    const broken = g.edges.find((e) => e.broken)!;
    expect(g.nodes[broken.from]!.label).toBe('/entrar');
    expect(g.nodes[broken.to]!.label).toBe('<Login/>');
    const mid = { x: (g.nodes[1]!.x + g.nodes[2]!.x) / 2, y: (g.nodes[1]!.y + g.nodes[2]!.y) / 2 };
    const p = sample(x.keys, T.GRAPH_FOUND + 300);
    expect(Math.hypot(p.x - mid.x, p.y - mid.y)).toBeLessThan(2);
    expect(x.think.some((iv) => within(iv, T.GRAPH_FOUND - 100))).toBe(true);
    expect(T.GRAPH_FIXED).toBeGreaterThan(T.TYPE2[1]); // fica verde depois da correção
  });

  it('Y puxa o DevTools da borda, vai à aba Console, marca o 404 e confere o 200 no fim', () => {
    const { y } = cursorTracks(L);
    const dv = devtools(L);
    expect(sample(y.keys, T.DEV_PULL[0]).x).toBeCloseTo(dv.closed - 5);
    expect(sample(y.keys, T.DEV_PULL[1]).x).toBeCloseTo(dv.open + 5);
    expect(y.press.some((iv) => within(iv, (T.DEV_PULL[0] + T.DEV_PULL[1]) / 2))).toBe(true);
    expect(sample(y.keys, T.DEV_TAB)).toMatchObject({ x: dv.open + dv.tab.dx, y: dv.tab.y });
    expect(sample(y.keys, T.DEV_FOUND).y).toBeCloseTo(dv.line(0));
    expect(sample(y.keys, T.DEV_OK).y).toBeCloseTo(dv.line(4));
    expect(T.DEV_FINAL[0]).toBeGreaterThan(T.GRAPH_FIXED);
  });

  it('D passa bem perto da câmera, desacelera e pisca duas vezes ali', () => {
    const { d } = cursorTracks(L);
    let peak = { t: 0, z: -Infinity };
    for (let t = T.ORBIT_D[0]; t <= T.ORBIT_D[1]; t += 10) {
      const z = sample(d.keys, t).z;
      if (z > peak.z) peak = { t, z };
    }
    expect(depthScale(peak.z)).toBeGreaterThan(5.5);
    expect(d.blinks).toHaveLength(2);
    for (const b of d.blinks!) expect(Math.abs(b - peak.t)).toBeLessThan(260);
  });

  it('as chaves de Y no DevTools são da tela (o painel fica preso no canto, a câmera não o mexe)', () => {
    const { y } = cursorTracks(L);
    const inDev = y.keys.filter((k) => k.t >= T.DEV_PULL[0] && k.t <= T.DEV_FINAL[1]);
    expect(inDev.length).toBeGreaterThan(8);
    expect(inDev.every((k) => k.screen)).toBe(true);
  });

  it('o progresso vai de 0 a 100 sem voltar', () => {
    let prev = -1;
    for (let t = T.BOX[0] - 500; t <= T.END; t += 50) {
      const p = progressAt(t);
      expect(p).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
    expect(progressAt(T.BOX[0])).toBe(0);
    expect(progressAt(T.END)).toBe(100);
  });
});

describe('física das peças', () => {
  const floor = 300;
  const run = (b: ReturnType<typeof makeBody>, ms: number, start = 0) => {
    for (let t = start; t < start + ms; t += 10) stepBody(b, 0.01, t, floor, -500, 500);
  };

  it('a peça espera a sua vez, cai, quica para o lado e deita no chão', () => {
    const b = makeBody(0, -100, 40, 50, { start: 500, rest: 0.35, kick: 300, tipTarget: 80, yawTarget: 20, vspin: 100 });
    run(b, 400);
    expect(b.active).toBe(false);
    expect(b.y).toBe(-100);
    run(b, 3000, 400);
    expect(b.y).toBe(floor);
    expect(b.landed).toBe(true);
    expect(b.x).toBeGreaterThan(20);
    expect(b.tip).toBe(80);
    expect(b.yaw).toBeCloseTo(20, 0);
    expect(b.spin).toBeCloseTo(0, 1);
    expect(b.asleep).toBe(true);
  });

  it('não atravessa as paredes', () => {
    const b = makeBody(450, 0, 40, 50, { start: 0, rest: 0.3, kick: 4000, tipTarget: -70, yawTarget: 0, vspin: 0 });
    run(b, 3000);
    expect(b.x + b.w / 2).toBeLessThanOrEqual(500);
    expect(b.tip).toBe(-70);
  });

  it('a peça grande que cai perto faz as pequenas pularem para longe dela', () => {
    const big = makeBody(0, 0, 120, 160, { start: 0, rest: 0.2, kick: 0, tipTarget: 80, yawTarget: 0, vspin: 0 });
    const small = makeBody(30, floor, 20, 20, { start: 0, rest: 0.3, kick: 0, tipTarget: 70, yawTarget: 0, vspin: 0 });
    small.active = true;
    small.asleep = true;
    kickAround(big, [big, small], rng(1));
    expect(small.asleep).toBe(false);
    expect(small.vy).toBeLessThan(0);
    expect(small.vx).toBeGreaterThan(0);
  });

  it('o sorteio com semente repete', () => {
    const a = rng(404);
    const b = rng(404);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

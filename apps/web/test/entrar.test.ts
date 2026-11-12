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

  it('B chega perto da câmera para puxar os balões e todos saem da tela no fim', () => {
    const tracks = cursorTracks(L);
    expect(sample(tracks.b.keys, T.GRAB_P1[0]).z).toBeGreaterThan(0.5);
    for (const tr of Object.values(tracks)) {
      const end = sample(tr.keys, T.EXIT[1]);
      expect(end.z).toBe(-1);
      expect(Math.abs(end.x) > L.vw / 2 || Math.abs(end.y) > L.vh / 2).toBe(true);
    }
  });

  it('C clica na última cor da paleta, a do fundo', () => {
    const { c } = cursorTracks(L);
    const sw = palette(L).swatches[4]!;
    const p = sample(c.keys, T.PALETTE_CLICK);
    expect(Math.hypot(p.x - sw.x, p.y - sw.y)).toBeLessThan(15);
    expect(c.clicks).toContain(T.PALETTE_CLICK);
  });

  it('D leva o logo e desenha o e-mail e o botão; C desenha a senha ao mesmo tempo', () => {
    const { c, d } = cursorTracks(L);
    expect(sample(d.keys, T.LOGO[1])).toMatchObject({ x: cx(L.logo), y: cy(L.logo) });
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
    for (const tr of Object.values(tracks)) {
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
    const cam = [...introCamera(1088, 690), ...rebuildCamera(L).slice(1)];
    let tilt = 0;
    for (let t = T.BOX[0]; t < T.HIGH5; t += 50) {
      const c = sampleCam(cam, t);
      tilt = Math.max(tilt, Math.abs(c.rx), Math.abs(c.ry));
    }
    expect(tilt).toBeGreaterThan(5);
    expect(sampleCam(cam, T.END)).toMatchObject({ s: 1, rx: 0, ry: 0 });
  });

  it('a profundidade em px dá a mesma escala da perspectiva', () => {
    for (const z of [-1, 0, 1, 3.6]) {
      const px = depthPx(z);
      expect(1100 / (1100 - px)).toBeCloseTo(depthScale(z), 6);
    }
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

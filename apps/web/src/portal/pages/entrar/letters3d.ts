// O 404 em 3D de verdade com three.js (decisão 0040). Cada caractere é desenhado num canvas com a
// mesma fonte do HTML, o contorno dos pixels vira uma forma (contour.ts) e a forma é extrudada: a
// letra 3D nasce idêntica ao texto da página. Luz, sombra no chão e numa parede atrás. A física é a
// mesma do resto (physics.ts): aqui só se desenha. Também o confete 3D do encontro do fim.
//
// Este arquivo é carregado com import() pelo motor, só no /entrar: o three.js fica num pedaço à parte.
import * as THREE from 'three';
import { outlines } from './contour';

export interface GlyphIn {
  ch: string;
  /** a fonte do CSS, por exemplo `700 270px "Times New Roman", Times, serif` */
  font: string;
  px: number;
  /** a caixa do caractere na tela, relativa ao centro (y para baixo) */
  rect: { l: number; t: number; r: number; b: number };
  /** o ponto em que a física gira a peça: o meio de baixo */
  pivot: { x: number; y: number };
}

export interface BodyPose {
  x: number;
  y: number;
  tip: number;
  yaw: number;
  spin: number;
}

const DEG = Math.PI / 180;
const DIST = 1100; // a mesma perspectiva da cena em CSS

/** A forma 3D de um caractere, com a origem na pena (início da linha de base), em px da tela. */
function glyphShapes(ch: string, font: string, px: number): THREE.Shape[] {
  const up = px < 80 ? 4 : px < 160 ? 2 : 1; // letras pequenas são desenhadas maiores e reduzidas
  const size = px * up;
  const cv = document.createElement('canvas');
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  const scaledFont = font.replace(`${px}px`, `${size}px`);
  ctx.font = scaledFont;
  const pad = Math.ceil(size * 0.2);
  const w = Math.ceil(ctx.measureText(ch).width + pad * 2);
  const h = Math.ceil(size * 1.5);
  const base = Math.ceil(size * 1.1);
  cv.width = w;
  cv.height = h;
  ctx.font = scaledFont;
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(ch, pad, base);
  const data = ctx.getImageData(0, 0, w, h).data;
  const out = outlines((x, y) => data[(y * w + x) * 4 + 3]! > 110, w, h, 4 * up * up);
  const toV = (p: readonly [number, number]) => new THREE.Vector2((p[0] - pad) / up, -(p[1] - base) / up);
  return out.map((o) => {
    const shape = new THREE.Shape(o.outer.map(toV));
    for (const hole of o.holes) shape.holes.push(new THREE.Path(hole.map(toV)));
    return shape;
  });
}

function makeRenderer(canvas: HTMLCanvasElement, vw: number, vh: number, shadows: boolean) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(vw, vh, false);
  renderer.setClearColor(0x000000, 0);
  if (shadows) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }
  const camera = new THREE.PerspectiveCamera((2 * Math.atan(vh / 2 / DIST)) / DEG, vw / vh, 1, 6000);
  camera.position.set(0, 0, DIST);
  return { renderer, camera };
}

export interface Letters3D {
  /** põe as peças onde a física manda e a câmera onde a cena está (zoom e ponto de foco) */
  frame(poses: readonly BodyPose[], cam: { s: number; fx: number; fy: number }, shadowFade: number): void;
  dispose(): void;
}

export function createLetters3D(canvas: HTMLCanvasElement, glyphs: readonly GlyphIn[], vw: number, vh: number, floorY: number): Letters3D {
  const { renderer, camera } = makeRenderer(canvas, vw, vh, true);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0xd9d9d9, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(-420, 760, 900);
  sun.target.position.set(0, -floorY, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  const sc = sun.shadow.camera;
  sc.left = -vw * 0.8;
  sc.right = vw * 0.8;
  sc.top = vh * 0.9;
  sc.bottom = -vh * 0.9;
  sc.near = 10;
  sc.far = 4000;
  sun.shadow.radius = 5;
  sun.shadow.bias = -0.0008;
  scene.add(sun, sun.target);

  // o chão (onde as peças caem) e uma parede branca logo atrás (onde a sombra delas aparece em pé)
  const floorMat = new THREE.ShadowMaterial({ opacity: 0 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(vw * 4, 3000), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -floorY;
  floor.receiveShadow = true;
  const wallMat = new THREE.ShadowMaterial({ opacity: 0 });
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(vw * 4, vh * 4), wallMat);
  wall.position.z = -160;
  wall.receiveShadow = true;
  scene.add(floor, wall);

  const face = new THREE.MeshStandardMaterial({ color: 0x0b0b0b, roughness: 0.42, metalness: 0.05 });
  const side = new THREE.MeshStandardMaterial({ color: 0x4a4a4a, roughness: 0.62, metalness: 0.0 });
  const groups: THREE.Group[] = [];
  const geoms: THREE.BufferGeometry[] = [];
  for (const g of glyphs) {
    const shapes = glyphShapes(g.ch, g.font, g.px);
    const depth = g.px * 0.13;
    const geo = new THREE.ExtrudeGeometry(shapes, {
      depth,
      curveSegments: 1,
      bevelEnabled: true,
      bevelThickness: depth * 0.12,
      bevelSize: Math.max(0.4, g.px * 0.008),
      bevelSegments: 2,
    });
    geo.translate(0, 0, -depth); // a face fica no plano da tela e o corpo vai para trás, como no CSS
    geoms.push(geo);
    const mesh = new THREE.Mesh(geo, [face, side]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // a pena do caractere fica no canto de baixo à esquerda da caixa, na linha de base
    const baseline = g.rect.b - g.px * 0.0125;
    mesh.position.set(g.rect.l - g.pivot.x, -(baseline - g.pivot.y), 0);
    const group = new THREE.Group();
    group.add(mesh);
    group.position.set(g.pivot.x, -g.pivot.y, 0);
    scene.add(group);
    groups.push(group);
  }

  return {
    frame(poses, cam, shadowFade) {
      poses.forEach((p, i) => {
        const g = groups[i];
        if (!g) return;
        g.position.set(p.x, -p.y, 0);
        // a ordem e os sinais do CSS: rotateY(yaw) rotateX(tip) rotateZ(spin), com o y para baixo
        g.rotation.set(-p.tip * DEG, p.yaw * DEG, -p.spin * DEG, 'YXZ');
      });
      floorMat.opacity = 0.26 * shadowFade;
      wallMat.opacity = 0.14 * shadowFade;
      if (camera.zoom !== cam.s) {
        camera.zoom = cam.s;
        camera.updateProjectionMatrix();
      }
      camera.position.set(cam.fx, -cam.fy, DIST);
      renderer.render(scene, camera);
    },
    dispose() {
      geoms.forEach((g) => g.dispose());
      face.dispose();
      side.dispose();
      floor.geometry.dispose();
      wall.geometry.dispose();
      floorMat.dispose();
      wallMat.dispose();
      renderer.dispose();
    },
  };
}

export interface Confetti3D {
  /** t em ms desde o estouro; devolve false quando acabou */
  frame(t: number): boolean;
  dispose(): void;
}

/** O confete 3D do encontro: peças da marca que sobem, giram e caem, com luz, a partir de um ponto da tela. */
export function createConfetti3D(canvas: HTMLCanvasElement, vw: number, vh: number, from: { x: number; y: number }, seed: () => number): Confetti3D {
  const { renderer, camera } = makeRenderer(canvas, vw, vh, false);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x334433, 1.3));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(-300, 600, 800);
  scene.add(key);
  const colors = [0x10ef7c, 0xa0f994, 0xffffff, 0xffd166, 0x0f1311];
  const mats = colors.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.35, metalness: 0.1, side: THREE.DoubleSide }));
  const geos = [new THREE.BoxGeometry(14, 8, 2), new THREE.PlaneGeometry(10, 16), new THREE.TetrahedronGeometry(7), new THREE.TorusGeometry(6, 2.2, 6, 12)];
  const pieces = Array.from({ length: 46 }, () => {
    const m = new THREE.Mesh(geos[Math.floor(seed() * geos.length)]!, mats[Math.floor(seed() * mats.length)]!);
    m.position.set(from.x, -from.y, 0);
    scene.add(m);
    const ang = seed() * Math.PI * 2;
    const sp = 260 + seed() * 520;
    return {
      m,
      v: new THREE.Vector3(Math.cos(ang) * sp, 380 + seed() * 640, (seed() - 0.5) * 700),
      w: new THREE.Vector3((seed() - 0.5) * 14, (seed() - 0.5) * 14, (seed() - 0.5) * 14),
    };
  });
  let last = 0;
  return {
    frame(t) {
      const dt = Math.min(0.05, Math.max(0, (t - last) / 1000));
      last = t;
      for (const p of pieces) {
        p.v.y -= 1500 * dt;
        p.v.multiplyScalar(Math.exp(-0.9 * dt));
        p.m.position.addScaledVector(p.v, dt);
        p.m.rotation.x += p.w.x * dt;
        p.m.rotation.y += p.w.y * dt;
        p.m.rotation.z += p.w.z * dt;
      }
      const fade = Math.max(0, Math.min(1, (1900 - t) / 500));
      mats.forEach((m) => {
        m.transparent = fade < 1;
        m.opacity = fade;
      });
      renderer.render(scene, camera);
      return t < 1900;
    },
    dispose() {
      geos.forEach((g) => g.dispose());
      mats.forEach((m) => m.dispose());
      renderer.dispose();
    },
  };
}

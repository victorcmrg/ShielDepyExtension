// Captura a tela do monitor da demo da landing quadro a quadro (decisão 0051), no Edge/Chrome headless da
// máquina, pelo protocolo de depuração (CDP) e o WebSocket do próprio Node: nada para instalar.
//
//   node apps/web/scripts/demo-video/capture.mjs --out <pasta> [--variant wide|compact] [--fps 30]
//
// Precisa do `npm run web:dev` rodando (a landing abre com ?capture=demo, que só existe no modo dev). Só a
// tela entra: ela sai do monitor e fica fixa no canto da página, e a janela tem exatamente o tamanho dela
// (1000×625 na versão larga, 560×350 na compacta). O que fica fora da tela (as bolhas de vidro, o monitor)
// não aparece. A densidade de pixels deixa o vídeo nítido em telas de alta densidade: 1,6 na larga
// (1600×1000) e 2 na compacta (1120×700). Cada quadro avança a linha do tempo e as animações de CSS em
// exatamente 1/fps s (window.__demoCapture.step) e sai como PNG: <out>/f00000.png… e <out>/meta.json.
// Uma coisa por vez: um navegador só, um quadro por vez.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .join(' ')
    .split('--')
    .filter(Boolean)
    .map((kv) => {
      const [k, ...v] = kv.trim().split(' ');
      return [k, v.join(' ') || true];
    })
);
const OUT = args.out;
if (!OUT || OUT === true) throw new Error('falta --out <pasta>');
const VARIANT = args.variant === 'compact' ? 'compact' : 'wide';
const FPS = Number(args.fps || 30);
const SIZE = VARIANT === 'compact' ? { w: 560, h: 350, dpr: 2 } : { w: 1000, h: 625, dpr: 1.6 };
const URL_ = args.url || 'http://localhost:5173/?capture=demo';
const PORT = 9334;

const BROWSERS = [
  process.env.CAPTURE_BROWSER,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);
const exe = BROWSERS.find((p) => existsSync(p));
if (!exe) throw new Error('nenhum Chrome/Edge encontrado (defina CAPTURE_BROWSER)');

mkdirSync(OUT, { recursive: true });
const profile = join(tmpdir(), `demo-capture-${process.pid}`);
const browser = spawn(
  exe,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    `--window-size=${SIZE.w},${SIZE.h}`,
    `--force-device-scale-factor=${SIZE.dpr}`,
    '--hide-scrollbars',
    '--mute-audio',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--force-color-profile=srgb',
    'about:blank',
  ],
  { stdio: 'ignore' }
);
const cleanup = () => {
  try {
    browser.kill();
  } catch {}
  setTimeout(() => rmSync(profile, { recursive: true, force: true }), 1500);
};
process.on('exit', cleanup);
process.on('SIGINT', () => process.exit(130));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function json(path) {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}${path}`);
      if (r.ok) return await r.json();
    } catch {}
    await sleep(150);
  }
  throw new Error('o navegador não respondeu');
}

const pages = await json('/json/list');
const page = pages.find((p) => p.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => {
  ws.onopen = r;
  ws.onerror = j;
});
let id = 0;
const waiting = new Map();
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && waiting.has(msg.id)) {
    const { res, rej } = waiting.get(msg.id);
    waiting.delete(msg.id);
    msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
  }
};
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const n = ++id;
    waiting.set(n, { res, rej });
    ws.send(JSON.stringify({ id: n, method, params }));
  });
const evaluate = async (expression, awaitPromise = false) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: SIZE.w, height: SIZE.h, deviceScaleFactor: SIZE.dpr, mobile: false, screenWidth: SIZE.w, screenHeight: SIZE.h });
// a página da landing fica em cima (sem rolagem): a demo começa parada, e a captura a dirige
await send('Page.navigate', { url: URL_ });
for (let i = 0; i < 200 && !(await evaluate('!!window.__demoCapture').catch(() => false)); i++) await sleep(100);
if (!(await evaluate('!!window.__demoCapture'))) throw new Error('a página não abriu em modo de captura (o web:dev está rodando?)');
await evaluate('window.__demoCapture.ready.then(() => true)', true);
await evaluate('document.fonts.ready.then(() => true)', true);

const box = await evaluate(`window.__demoCapture.setCompact(${VARIANT === 'compact'})`);
const screen = await evaluate('({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio })');
if (box.w !== SIZE.w || box.h !== SIZE.h) throw new Error(`a tela tem ${box.w}×${box.h}, esperado ${SIZE.w}×${SIZE.h}`);
// o navegador devolve a densidade em ponto flutuante (1,6 vem como 1,600000024): compara com folga
if (screen.w !== SIZE.w || screen.h !== SIZE.h || Math.abs(screen.dpr - SIZE.dpr) > 0.001) throw new Error(`janela errada: ${JSON.stringify(screen)}`);
console.log(`versão ${VARIANT}: ${SIZE.w}×${SIZE.h} @${SIZE.dpr} (${Math.round(SIZE.w * SIZE.dpr)}×${Math.round(SIZE.h * SIZE.dpr)}) · ${FPS} quadros/s · ${exe.split('/').pop()}`);

const duration = await evaluate('window.__demoCapture.duration');
const total = Math.round(duration * FPS); // um laço inteiro: o quadro seguinte ao último é o primeiro
const dt = 1000 / FPS;
const settle = 'new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))';
await evaluate('window.__demoCapture.step(0)');
const t0 = Date.now();
for (let n = 0; n < total; n++) {
  if (n > 0) await evaluate(`window.__demoCapture.step(${dt})`);
  await evaluate(settle, true);
  const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  writeFileSync(join(OUT, `f${String(n).padStart(5, '0')}.png`), Buffer.from(shot.data, 'base64'));
  if ((n + 1) % 60 === 0) console.log(`  ${n + 1}/${total} quadros · ${((Date.now() - t0) / (n + 1)).toFixed(0)} ms por quadro`);
}
writeFileSync(join(OUT, 'meta.json'), JSON.stringify({ variant: VARIANT, fps: FPS, frames: total, duration, ...SIZE }, null, 1));
console.log(`pronto: ${total} quadros em ${((Date.now() - t0) / 1000).toFixed(0)} s → ${OUT}`);
ws.close();
process.exit(0);

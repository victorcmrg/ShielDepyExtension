// Captura a encenação do "Entrar" quadro a quadro (decisão 0043), no Edge/Chrome headless da máquina,
// pelo protocolo de depuração (CDP) e o WebSocket do próprio Node: nada para instalar.
//
//   node apps/web/scripts/entrar-video/capture.mjs --out <pasta> [--width 1920 --height 1080] [--from ms] [--to ms] [--fps 60]
//
// Precisa do `npm run web:dev` rodando (a página abre com ?capture, que só existe no modo dev). A tela é
// fixa (1920×1080 por padrão, ou --width/--height) com densidade 1 (janela, página e captura do mesmo tamanho) e o script confere isso
// antes de começar. Cada quadro avança o relógio da cena e de todas as animações em exatamente 1/fps s
// (window.__entrarCapture.step) e sai como PNG: <out>/f00000.png… e <out>/cues.json (os sons).
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
const FPS = Number(args.fps || 60);
const FROM = Number(args.from || 0);
const TO = args.to ? Number(args.to) : Infinity;
const W = Number(args.width || 1920);
const H = Number(args.height || 1080);
const URL_ = args.url || 'http://localhost:5173/entrar?capture';
const PORT = 9333;

const BROWSERS = [
  process.env.CAPTURE_BROWSER,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);
const exe = BROWSERS.find((p) => existsSync(p));
if (!exe) throw new Error('nenhum Chrome/Edge encontrado (defina CAPTURE_BROWSER)');

mkdirSync(OUT, { recursive: true });
const profile = join(tmpdir(), `entrar-capture-${process.pid}`);
const browser = spawn(
  exe,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    `--window-size=${W},${H}`,
    '--force-device-scale-factor=1',
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
const events = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && waiting.has(msg.id)) {
    const { res, rej } = waiting.get(msg.id);
    waiting.delete(msg.id);
    msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
  } else if (msg.method) events.push(msg.method);
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
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false, screenWidth: W, screenHeight: H });
await send('Page.navigate', { url: URL_ });
for (let i = 0; i < 200 && !(await evaluate('!!window.__entrarCapture').catch(() => false)); i++) await sleep(100);
if (!(await evaluate('!!window.__entrarCapture'))) throw new Error('a página não abriu em modo de captura (o web:dev está rodando?)');
await evaluate('window.__entrarCapture.ready.then(() => true)', true);
await evaluate('document.fonts.ready.then(() => true)', true);
// --css "<regra>": só para experimentos (por exemplo, esconder uma peça e comparar os quadros)
if (args.css && args.css !== true) await evaluate(`(() => { const s = document.createElement('style'); s.textContent = ${JSON.stringify(String(args.css))}; document.head.appendChild(s); return true; })()`);

const screen = await evaluate('({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio, sw: screen.width, sh: screen.height })');
if (screen.w !== W || screen.h !== H || screen.dpr !== 1) throw new Error(`tela errada: ${JSON.stringify(screen)} (esperado ${W}×${H} @1)`);
console.log(`tela ${screen.w}×${screen.h} @${screen.dpr} · ${FPS} quadros/s · ${exe.split('/').pop()}`);

const dt = 1000 / FPS;
const frameOf = (ms) => Math.round(ms / dt);
const firstFrame = frameOf(FROM);
const settle = 'new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))';
let state = await evaluate('window.__entrarCapture.step(0)');
// avança sem capturar até o primeiro quadro pedido (mesmos passos de 1/fps: a física dá o mesmo resultado)
for (let f = 1; f <= firstFrame; f++) state = await evaluate(`window.__entrarCapture.step(${dt})`);
let tailFrames = Math.round(0.8 * FPS); // depois do fim, a tela de verdade entra por cima
const t0 = Date.now();
let n = 0;
for (let f = firstFrame; ; f++) {
  if (f > firstFrame) state = await evaluate(`window.__entrarCapture.step(${dt})`);
  await evaluate(settle, true);
  const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  writeFileSync(join(OUT, `f${String(n).padStart(5, '0')}.png`), Buffer.from(shot.data, 'base64'));
  n++;
  if (n % 60 === 0) console.log(`  ${n} quadros · cena em ${Math.round(state.t)} ms · ${((Date.now() - t0) / n).toFixed(0)} ms por quadro`);
  if (f * dt >= TO) break;
  if (state.ended && --tailFrames <= 0) break;
}
const cues = await evaluate('window.__entrarCapture.cues()');
writeFileSync(join(OUT, 'cues.json'), JSON.stringify({ ...cues, fps: FPS, from: FROM, frames: n, width: W, height: H }, null, 1));
console.log(`pronto: ${n} quadros em ${((Date.now() - t0) / 1000).toFixed(0)} s → ${OUT}`);
ws.close();
process.exit(0);

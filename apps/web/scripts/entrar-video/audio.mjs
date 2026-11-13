// A trilha do vídeo do "Entrar" (decisão 0043): mistura, fora do navegador, os mesmos sons que o
// Web Audio tocaria (src/portal/pages/entrar/sfx.ts), nos instantes que a captura marcou (cues.json):
// cada som com o ganho, a velocidade (tom), o corte com fade e o volume geral de lá; a madeira é o laço
// com o volume seguindo as marcações (com a mesma suavização de 60 ms). Sai PCM float 48 kHz mono.
//
//   node apps/web/scripts/entrar-video/audio.mjs <pasta com cues.json>   →   <pasta>/audio.f32
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = process.argv[2];
if (!dir) throw new Error('uso: audio.mjs <pasta com cues.json>');
const RATE = 48000;
const MASTER = 0.32; // o mesmo de sfx.ts
const here = fileURLToPath(new URL('.', import.meta.url));
const SFX = resolve(here, '../../public/sfx');

const { cues, wood, frames, fps } = JSON.parse(readFileSync(join(dir, 'cues.json'), 'utf8'));
const seconds = frames / fps;
const out = new Float32Array(Math.ceil(seconds * RATE) + RATE);

const cache = new Map();
function load(name) {
  if (!cache.has(name)) {
    const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', join(SFX, `${name}.mp3`), '-f', 'f32le', '-ac', '1', '-ar', String(RATE), '-'], { maxBuffer: 1 << 28 });
    cache.set(name, new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4));
  }
  return cache.get(name);
}
// lê a amostra em posição fracionária (a velocidade muda o tom, como o playbackRate)
const at = (buf, pos) => {
  const i = Math.floor(pos);
  if (i < 0 || i + 1 >= buf.length) return 0;
  const f = pos - i;
  return buf[i] * (1 - f) + buf[i + 1] * f;
};

for (const c of cues) {
  const buf = load(c.name);
  const o = c.o || {};
  const gain = o.gain ?? 1;
  const rate = o.rate ?? 1;
  const start = Math.round((c.t / 1000) * RATE);
  const off = (o.offset ?? 0) * RATE;
  const len = o.dur ? Math.round(o.dur * RATE) : Math.ceil((buf.length - off) / rate);
  const fadeFrom = o.dur ? Math.max(0, o.dur - 0.12) * RATE : Infinity;
  for (let k = 0; k < len; k++) {
    const pos = off + k * rate;
    if (pos >= buf.length) break;
    let g = gain;
    if (k > fadeFrom) g *= Math.max(0, 1 - (k - fadeFrom) / (len - fadeFrom));
    const j = start + k;
    if (j < out.length) out[j] += at(buf, pos) * g * MASTER;
  }
}

// a madeira: o laço começa no primeiro volume acima de zero e segue as marcações, suavizado como o
// setTargetAtTime(…, 0.06) do Web Audio
if (wood.length) {
  const buf = load('wood-drag');
  const tau = 0.06 * RATE;
  const k = 1 - Math.exp(-1 / tau);
  const first = wood.find(([, g]) => g > 0);
  if (first) {
    const s0 = Math.round((first[0] / 1000) * RATE);
    let target = 0;
    let g = 0;
    let wi = 0;
    for (let j = s0; j < out.length; j++) {
      while (wi < wood.length && (wood[wi][0] / 1000) * RATE <= j) target = wood[wi++][1];
      g += (target - g) * k;
      if (g < 1e-4 && target === 0) continue;
      out[j] += buf[(j - s0) % buf.length] * g * MASTER;
    }
  }
}

let peak = 0;
for (const v of out) peak = Math.max(peak, Math.abs(v));
// sem clipar: se algum pico passar de 0,98, abaixa tudo junto (não acontece com os volumes de hoje)
if (peak > 0.98) for (let j = 0; j < out.length; j++) out[j] *= 0.98 / peak;
writeFileSync(join(dir, 'audio.f32'), Buffer.from(out.buffer, 0, Math.ceil(seconds * RATE) * 4));
console.log(`trilha: ${cues.length} sons, ${wood.length} marcas da madeira, ${seconds.toFixed(2)} s, pico ${peak.toFixed(3)}`);

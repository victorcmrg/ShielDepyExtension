// Codifica o vídeo da demo da landing a partir dos quadros da captura (decisão 0051), um passo por vez e
// com threads limitadas (a máquina não aguenta tudo junto). Sem som: a demo toca muda.
//   1. <nome>-poster.webp: o primeiro quadro (aparece na hora, antes do vídeo);
//   2. <nome>-av1.webm: AV1 10 bits, o mais leve (texto de interface comprime muito bem);
//   3. <nome>-h264.mp4: H.264 High, para onde não houver AV1, com o índice no começo (faststart) para
//      começar a tocar antes de baixar tudo.
// As cores saem marcadas como BT.709, convertidas do sRGB dos quadros.
//
//   node apps/web/scripts/demo-video/encode.mjs <pasta dos quadros> <pasta de saída> <nome, ex.: demo-1000> [--only av1|h264|poster]
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const [src, dst, name] = process.argv.slice(2);
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
if (!src || !dst || !name || name.startsWith('--')) throw new Error('uso: encode.mjs <quadros> <saída> <nome>');
mkdirSync(dst, { recursive: true });
const { fps } = JSON.parse(readFileSync(join(src, 'meta.json'), 'utf8'));
const THREADS = '4';

const frames = ['-framerate', String(fps), '-i', join(src, 'f%05d.png')];
const color = ['-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv'];
const toYuv = (fmt) => `scale=out_color_matrix=bt709:out_range=tv:flags=lanczos+accurate_rnd+full_chroma_int,format=${fmt}`;

function run(label, args) {
  const t = Date.now();
  console.log(`→ ${label}`);
  execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-stats', '-y', ...args], { stdio: 'inherit' });
  const out = args[args.length - 1];
  console.log(`  ${label}: ${(statSync(out).size / 1024).toFixed(0)} KB em ${((Date.now() - t) / 1000).toFixed(0)} s`);
}

if (!only || only === 'poster') {
  run('poster', ['-i', join(src, 'f00000.png'), '-c:v', 'libwebp', '-quality', '90', '-compression_level', '6', join(dst, `${name}-poster.webp`)]);
}
if (!only || only === 'av1') {
  run('AV1', [
    ...frames,
    '-vf', toYuv('yuv420p10le'),
    '-c:v', 'libsvtav1', '-preset', '5', '-crf', '36', '-g', String(fps * 4),
    '-svtav1-params', `tune=0:lp=${THREADS}:scd=1`,
    ...color,
    '-an',
    join(dst, `${name}-av1.webm`),
  ]);
}
if (!only || only === 'h264') {
  run('H.264', [
    ...frames,
    '-vf', toYuv('yuv420p'),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '24', '-tune', 'animation', '-profile:v', 'high', '-level:v', '4.2',
    '-g', String(fps * 4), '-threads', THREADS,
    ...color,
    '-an',
    '-movflags', '+faststart',
    join(dst, `${name}-h264.mp4`),
  ]);
}

// Codifica o vídeo do "Entrar" a partir dos quadros da captura (decisão 0043), um passo por vez e com
// threads limitadas (a máquina não aguenta tudo junto):
//   1. <nome>-poster.webp: o primeiro quadro, sem perda (aparece na hora, antes do vídeo);
//   2. <nome>-av1.webm: AV1 10 bits (sem degraus nos degradês e nas sombras) + Opus, o mais leve;
//   3. <nome>-h264.mp4: H.264 High 4.2 + AAC, para onde não houver AV1, com o índice no começo
//      (faststart) para começar a tocar antes de baixar tudo.
// As cores saem marcadas como BT.709 (o padrão de vídeo HD), convertidas do sRGB dos quadros.
//
//   node apps/web/scripts/entrar-video/encode.mjs <pasta dos quadros> <pasta de saída> <nome, ex.: entrar-1080> [--only av1|h264|poster]
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const [src, dst, name] = process.argv.slice(2);
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
if (!src || !dst || !name || name.startsWith('--')) throw new Error('uso: encode.mjs <quadros> <saída> <nome>');
mkdirSync(dst, { recursive: true });
const { fps } = JSON.parse(readFileSync(join(src, 'cues.json'), 'utf8'));
const THREADS = '4';

const frames = ['-framerate', String(fps), '-i', join(src, 'f%05d.png')];
const audio = ['-f', 'f32le', '-ar', '48000', '-ac', '1', '-i', join(src, 'audio.f32')];
const color = ['-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv'];
const toYuv = (fmt) => `scale=out_color_matrix=bt709:out_range=tv:flags=lanczos+accurate_rnd+full_chroma_int,format=${fmt}`;

function run(name, args) {
  const t = Date.now();
  console.log(`→ ${name}`);
  execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-stats', '-y', ...args], { stdio: 'inherit' });
  const out = args[args.length - 1];
  console.log(`  ${name}: ${(statSync(out).size / 1024 / 1024).toFixed(2)} MB em ${((Date.now() - t) / 1000).toFixed(0)} s`);
}

if (!only || only === 'poster') {
  run('poster', ['-i', join(src, 'f00000.png'), '-c:v', 'libwebp', '-lossless', '1', '-compression_level', '6', join(dst, `${name}-poster.webp`)]);
}
if (!only || only === 'av1') {
  run('AV1', [
    ...frames, ...audio,
    '-vf', toYuv('yuv420p10le'),
    '-c:v', 'libsvtav1', '-preset', '5', '-crf', '28', '-g', String(fps * 2),
    '-svtav1-params', `tune=0:lp=${THREADS}:enable-overlays=1:scd=1`,
    ...color,
    '-c:a', 'libopus', '-b:a', '128k',
    '-shortest',
    join(dst, `${name}-av1.webm`),
  ]);
}
if (!only || only === 'h264') {
  run('H.264', [
    ...frames, ...audio,
    '-vf', toYuv('yuv420p'),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-tune', 'animation', '-profile:v', 'high', '-level:v', '4.2',
    '-g', String(fps * 2), '-threads', THREADS,
    ...color,
    '-c:a', 'aac', '-b:a', '160k',
    '-movflags', '+faststart',
    '-shortest',
    join(dst, `${name}-h264.mp4`),
  ]);
}

// Os sons da encenação do "Entrar" (decisão 0041): efeitos curtos do Epidemic Sound (a licença é da
// conta do usuário), todos baixinhos, só para complementar o que acontece. Web Audio: cada som é
// carregado uma vez (fetch + decodeAudioData) e tocado com ganho e velocidade próprios; os contínuos
// (a madeira arrastando) são laços que sobem e descem de volume com o movimento.

export type SfxName = 'whoosh-in' | 'whoosh-out' | 'thud-1' | 'thud-2' | 'thud-big' | 'click' | 'hum-1' | 'hum-2' | 'wood-drag' | 'key';
const NAMES: readonly SfxName[] = ['whoosh-in', 'whoosh-out', 'thud-1', 'thud-2', 'thud-big', 'click', 'hum-1', 'hum-2', 'wood-drag', 'key'];

/** O volume de tudo: baixo de propósito (os sons só complementam). */
export const MASTER = 0.32;

export interface PlayOpts {
  gain?: number;
  rate?: number;
  /** corta depois de tantos segundos, com um fade curto */
  dur?: number;
  /** começa no meio do som (segundos) */
  offset?: number;
}

export interface Loop {
  /** volume do laço (0 a 1), com transição suave */
  set(gain: number): void;
  stop(): void;
}

export interface Sfx {
  /** o navegador bloqueou o áudio até um clique na página */
  readonly blocked: boolean;
  /** tenta liberar o áudio (chamar num clique) */
  unlock(): Promise<boolean>;
  play(name: SfxName, o?: PlayOpts): void;
  loop(name: SfxName): Loop;
  /** abaixa tudo e encerra */
  close(): void;
}

const SILENT: Sfx = {
  blocked: false,
  unlock: async () => false,
  play: () => {},
  loop: () => ({ set: () => {}, stop: () => {} }),
  close: () => {},
};

export function createSfx(base = '/sfx/'): Sfx {
  const AC = typeof window !== 'undefined' ? window.AudioContext : undefined;
  if (!AC) return SILENT;
  let ctx: AudioContext;
  try {
    ctx = new AC();
  } catch {
    return SILENT;
  }
  const master = ctx.createGain();
  master.gain.value = MASTER;
  master.connect(ctx.destination);
  const buffers = new Map<SfxName, AudioBuffer>();
  for (const n of NAMES) {
    fetch(`${base}${n}.mp3`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then((ab) => ctx.decodeAudioData(ab))
      .then((buf) => buffers.set(n, buf))
      .catch(() => {});
  }
  void ctx.resume().catch(() => {});
  let closed = false;

  const voice = (name: SfxName, gain: number, rate: number, loop: boolean) => {
    const buf = buffers.get(name);
    if (!buf || closed || ctx.state !== 'running') return null;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = loop;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(master);
    return { src, g };
  };

  return {
    get blocked() {
      return !closed && ctx.state !== 'running';
    },
    async unlock() {
      try {
        await ctx.resume();
      } catch {
        /* segue sem som */
      }
      return ctx.state === 'running';
    },
    play(name, o = {}) {
      const v = voice(name, o.gain ?? 1, o.rate ?? 1, false);
      if (!v) return;
      const now = ctx.currentTime;
      v.src.start(now, o.offset ?? 0);
      if (o.dur) {
        v.g.gain.setValueAtTime(o.gain ?? 1, now + Math.max(0, o.dur - 0.12));
        v.g.gain.linearRampToValueAtTime(0, now + o.dur);
        v.src.stop(now + o.dur + 0.02);
      }
    },
    loop(name) {
      let v: ReturnType<typeof voice> = null;
      let target = 0;
      return {
        set(gain) {
          if (Math.abs(gain - target) < 0.01 && (v || gain <= 0)) return;
          target = gain;
          if (!v && gain > 0) {
            v = voice(name, 0, 1, true);
            v?.src.start();
          }
          if (v) v.g.gain.setTargetAtTime(gain, ctx.currentTime, 0.06);
        },
        stop() {
          if (!v) return;
          const n = v;
          v = null;
          target = 0;
          n.g.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
          n.src.stop(ctx.currentTime + 0.3);
        },
      };
    },
    close() {
      if (closed) return;
      closed = true;
      try {
        master.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
        window.setTimeout(() => void ctx.close().catch(() => {}), 700);
      } catch {
        /* nada a fazer */
      }
    },
  };
}

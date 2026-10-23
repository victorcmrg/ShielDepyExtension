// Peças pequenas dos painéis: número animado, switch e estado vazio.
import { useEffect, useRef, useState, type CSSProperties, type ElementType, type ReactNode } from 'react';
import { reduceMotion } from '../format';
import { Icon, type IconName } from './Icon';

/**
 * Número que conta do valor anterior até o novo (ease-out, 700 ms). Os quadros escrevem direto no
 * DOM pelo ref: animar com estado re-renderizaria o componente 60 vezes por segundo.
 */
export function CountUp({ value, as: Tag = 'strong', className, id }: { value: number; as?: ElementType; className?: string; id?: string }) {
  const ref = useRef<HTMLElement>(null);
  const shown = useRef(0);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const from = shown.current;
    const to = Number(value) || 0;
    shown.current = to;
    if (reduceMotion() || from === to) {
      node.textContent = String(to);
      return;
    }
    const start = performance.now();
    let raf = 0;
    let done = false;
    const frame = (now: number) => {
      const p = Math.min((now - start) / 700, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      node.textContent = String(Math.round(from + (to - from) * eased));
      if (p < 1) raf = requestAnimationFrame(frame);
      else done = true;
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      if (!done) shown.current = from; // interrompido antes do fim: a próxima conta sai de onde estava
    };
  }, [value]);
  return (
    <Tag ref={ref} className={className} id={id}>
      0
    </Tag>
  );
}

/** Switch acessível e animado. `onChange` devolve false quando a API recusa — aí ele volta. */
export function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (next: boolean) => Promise<boolean> }) {
  const [on, setOn] = useState(checked);
  const [busy, setBusy] = useState(false);
  useEffect(() => setOn(checked), [checked]);
  return (
    <label className={'sd-switch' + (busy ? ' busy' : '')}>
      <input
        type="checkbox"
        checked={on}
        onChange={async (e) => {
          const next = e.target.checked;
          setOn(next);
          setBusy(true);
          const ok = await onChange(next);
          if (ok === false) setOn(!next);
          setBusy(false);
        }}
      />
      <span className="sd-switch-track">
        <span className="sd-switch-thumb" />
      </span>
      <span className="sd-switch-label">{label}</span>
    </label>
  );
}

export function EmptyState({
  icon,
  title,
  text,
  compact,
  as: Tag = 'div',
  className = '',
  style,
  children,
}: {
  icon: IconName;
  title: string;
  text?: string;
  compact?: boolean;
  as?: ElementType;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}) {
  return (
    <Tag className={'empty-state' + (compact ? ' compact' : '') + (className ? ' ' + className : '')} style={style}>
      <Icon name={icon} />
      <strong>{title}</strong>
      {text !== undefined && <p>{text}</p>}
      {children}
    </Tag>
  );
}

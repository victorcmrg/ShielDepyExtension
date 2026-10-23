// Tema claro/escuro via data-theme na <html>. O valor inicial já foi aplicado pelo public/theme-init.js
// (antes do React); aqui só lemos e trocamos. useSyncExternalStore com snapshot de servidor null: a
// landing pré-renderizada nasce sem ícone e o React completa na hidratação, sem divergência.
import { useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark';

const KEY = 'shieldpy.theme';
const listeners = new Set<() => void>();

const read = (): Theme => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

export function toggleTheme(): void {
  const next: Theme = read() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* localStorage indisponível (aba privada) — segue só na sessão atual */
  }
  listeners.forEach((l) => l());
}

export function useTheme(): Theme | null {
  return useSyncExternalStore(subscribe, read, () => null);
}

export function ThemeToggle({ className }: { className: string }) {
  const theme = useTheme();
  return (
    <button
      id="themeToggle"
      className={className}
      type="button"
      onClick={toggleTheme}
      aria-label={theme ? (theme === 'dark' ? 'Ativar modo claro' : 'Ativar modo escuro') : undefined}
    >
      {theme === 'dark' ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 3.5v2M12 18.5v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M3.5 12h2M18.5 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="12" cy="12" r="4.5" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      ) : theme === 'light' ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M20 14.2A8.2 8.2 0 1 1 9.8 4a6.4 6.4 0 0 0 10.2 10.2Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      ) : null}
    </button>
  );
}

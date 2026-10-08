import type { ReactNode } from 'react';

/** Moldura das telas sem login (Entrar, Confirmar dispositivo): logo centralizado + cartão. */
export function AuthPage({ children }: { children: ReactNode }) {
  return (
    <div className="auth-page">
      <div className="auth-page-inner">
        <div className="auth-logo">
          <img src="/logo-mark.svg" alt="" />
          <span>ShielDepy</span>
        </div>
        {children}
      </div>
    </div>
  );
}

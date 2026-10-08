// Casca das telas logadas: gate de login + menu lateral (empresa e papel, navegação, conta) igual em
// todas as páginas. A navegação depende do papel:
//   membro → Projetos, Minha conta
//   dono   → + Equipe
//   admin da plataforma → + Plataforma
// O conteúdo da página só monta depois da checagem — nada de flash pra quem não está logado.
import { createContext, Suspense, useContext, useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ThemeToggle } from '../../shared/theme';
import { useAuth } from '../auth';
import { initial } from '../format';
import type { Me } from '../types';
import { Icon, type IconName } from '../ui/Icon';

export type PageKey = 'projects' | 'project' | 'team' | 'account' | 'platform' | 'tool';

const ROLE_LABEL: Record<string, string> = { owner: 'Dono da empresa', member: 'Membro' };

const MeContext = createContext<Me | null>(null);
const TitleContext = createContext<(title: string) => void>(() => {});

/** Quem está logado — só existe dentro do Shell, depois do gate. */
export function useMe(): Me {
  const me = useContext(MeContext);
  if (!me) throw new Error('useMe fora do Shell');
  return me;
}

/** Troca o título da barra do topo (ex.: o nome do projeto) e o da aba. */
export function usePageTitle(title: string | null): void {
  const setTitle = useContext(TitleContext);
  useEffect(() => {
    if (title === null) return;
    setTitle(title);
    document.title = title + ' — ShielDepy';
  }, [title, setTitle]);
}

interface ShellProps {
  page: PageKey;
  /** Barra do topo; a aba do navegador usa `docTitle` (ou "<title> — ShielDepy"). */
  title: string;
  docTitle?: string;
  mainClassName?: string;
  requireAdmin?: boolean;
  requireOwner?: boolean;
  /** Além de logado, exige a empresa com acesso liberado (senão mostra o bloqueio no lugar da página). */
  requireAccess?: boolean;
  children: ReactNode;
}

export function Shell({ page, title, docTitle, mainClassName = 'page', requireAdmin, requireOwner, requireAccess, children }: ShellProps) {
  const { state, refresh, logout } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [topTitle, setTopTitle] = useState(title);
  const [menuOpen, setMenuOpen] = useState(false);

  // revalida a sessão a cada tela (em segundo plano: o que já está na tela continua)
  useEffect(() => {
    refresh().catch(() => {});
  }, [pathname, refresh]);

  useEffect(() => {
    setTopTitle(title);
    document.title = docTitle ?? title + ' — ShielDepy';
    setMenuOpen(false);
  }, [title, docTitle, pathname]);

  // Celular: o menu vira gaveta aberta pelo botão da barra do topo.
  useEffect(() => {
    document.body.classList.toggle('side-open', menuOpen);
    return () => document.body.classList.remove('side-open');
  }, [menuOpen]);

  const me = state.status === 'ready' ? state.me : null;
  const denied = Boolean(me && ((requireAdmin && !me.isAdmin) || (requireOwner && me.role !== 'owner')));
  useEffect(() => {
    if (state.status === 'anon') navigate('/login?redirect=' + encodeURIComponent(pathname), { replace: true });
    else if (denied) navigate('/projects', { replace: true });
  }, [state.status, denied, navigate, pathname]);

  const blocked = Boolean(me && requireAccess && me.permissions.accessEnabled === false);
  const ready = me && !denied;

  return (
    <div className="app-shell">
      <aside className="sidebar" id="sidebar" aria-label="Menu">
        {ready && (
          <Sidebar
            me={me}
            page={page}
            onLogout={async () => {
              await logout();
              navigate('/login');
            }}
          />
        )}
      </aside>
      <div className="side-scrim" id="sideScrim" onClick={() => setMenuOpen(false)} />
      <div className="app-main">
        <header className="topbar">
          <button id="menuToggle" className="icon-btn" type="button" aria-label="Abrir menu" onClick={() => setMenuOpen((o) => !o)}>
            {ready && <Icon name="menu" />}
          </button>
          <span className="topbar-title">{topTitle}</span>
        </header>

        {!ready ? (
          <main id="main" className={(mainClassName ? mainClassName + ' ' : '') + 'gated-hidden'} />
        ) : blocked ? (
          <Blocked companyName={me.companyName} />
        ) : (
          <main id="main" className={mainClassName || undefined}>
            <MeContext.Provider value={me}>
              <TitleContext.Provider value={setTopTitle}>
                <Suspense fallback={null}>{children}</Suspense>
              </TitleContext.Provider>
            </MeContext.Provider>
          </main>
        )}
      </div>
    </div>
  );
}

function NavItem({ to, label, icon, active }: { to: string; label: string; icon: IconName; active: boolean }) {
  return (
    <Link to={to} className={'side-link' + (active ? ' active' : '')} aria-current={active ? 'page' : undefined}>
      <Icon name={icon} />
      <span>{label}</span>
    </Link>
  );
}

function Sidebar({ me, page, onLogout }: { me: Me; page: PageKey; onLogout: () => void }) {
  const off = me.permissions.accessEnabled === false;
  return (
    <>
      <Link to="/projects" className="side-brand">
        <img src="/logo-mark.svg" alt="" />
        <span>ShielDepy</span>
      </Link>

      <div className="side-company">
        <span className="side-company-avatar">{initial(me.companyName || '?')}</span>
        <div className="side-company-text">
          <strong>{me.companyName || 'Sem empresa'}</strong>
          <span>{ROLE_LABEL[me.role] || 'Membro'}</span>
        </div>
      </div>

      <nav className="side-nav" aria-label="Navegação principal">
        <NavItem to="/projects" label="Projetos" icon="grid" active={page === 'projects' || page === 'project'} />
        {me.role === 'owner' && <NavItem to="/team" label="Equipe" icon="users" active={page === 'team'} />}
        <NavItem to="/account" label="Minha conta" icon="user" active={page === 'account'} />
        {me.isAdmin && <NavItem to="/admin" label="Plataforma" icon="globe" active={page === 'platform'} />}
      </nav>

      <nav className="side-nav side-nav-secondary" aria-label="Outros">
        <NavItem to="/tool" label="Analisar no navegador" icon="code" active={page === 'tool'} />
      </nav>

      <div className="side-spacer" />

      <p className={'side-status' + (off ? ' off' : '')}>
        <span className="side-status-dot" />
        <span>{off ? 'Acesso da empresa suspenso' : 'Acesso liberado'}</span>
      </p>

      <div className="side-foot">
        <div className="side-user" title={me.email}>
          <span className="side-user-avatar">{initial(me.email)}</span>
          <span className="side-user-email">{me.email}</span>
        </div>
        <div className="side-foot-actions">
          <ThemeToggle className="theme-toggle" />
          <button className="side-logout" type="button" onClick={onLogout}>
            <Icon name="logout" />
            <span>Sair</span>
          </button>
        </div>
      </div>
    </>
  );
}

function Blocked({ companyName }: { companyName: string }) {
  return (
    <main id="main" className="blocked-wrap">
      <div className="blocked-card enter">
        <div className="blocked-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <rect x="5.2" y="10.8" width="13.6" height="9.5" rx="2.4" />
            <path d="M8 10.8V7.8a4 4 0 0 1 8 0v3" />
          </svg>
        </div>
        <h2>Acesso da empresa suspenso</h2>
        <p>O acesso de "{companyName}" à ferramenta está suspenso no momento. Fale com o administrador da sua conta para reativar.</p>
        <Link to="/projects" className="btn-brand">
          Voltar para o painel
        </Link>
      </div>
    </main>
  );
}

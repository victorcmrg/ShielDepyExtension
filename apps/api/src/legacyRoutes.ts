// Endereços antigos (páginas .html soltas, antes do React) → rotas novas. A extensão do VS Code e
// favoritos antigos ainda podem abrir /device-confirm.html?state=…; o redirect preserva a query.
// Usado pelo servidor (build) e pelo Vite (dev), pra os dois se comportarem igual.

const LEGACY_PAGES: Record<string, string> = {
  '/index.html': '/',
  '/login.html': '/login',
  '/device-confirm.html': '/device-confirm',
  '/projects.html': '/projects',
  '/team.html': '/team',
  '/account.html': '/account',
  '/admin.html': '/admin',
  '/app.html': '/tool',
};

/** Para onde redirecionar um endereço antigo, ou null se não for um. */
export function legacyRedirect(url: URL): string | null {
  if (url.pathname === '/project.html') {
    const id = url.searchParams.get('id');
    return id && /^\d+$/.test(id) ? `/projects/${id}` : '/projects';
  }
  const target = LEGACY_PAGES[url.pathname];
  return target ? target + url.search : null;
}

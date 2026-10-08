import type { NavigateFunction } from 'react-router-dom';

// Rotas que este app (portal) desenha. O resto — a landing "/", endereços .html antigos — é outra página
// do servidor e precisa de navegação completa.
const PORTAL_ROUTE = /^\/(login|device-confirm|projects(\/\d+)?|team|account|admin|tool)(?=$|[?#])/;

export function goTo(navigate: NavigateFunction, path: string): void {
  if (PORTAL_ROUTE.test(path)) navigate(path);
  else window.location.assign(path);
}

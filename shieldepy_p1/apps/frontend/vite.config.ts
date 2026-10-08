import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { legacyRedirect } from './server/legacyRoutes.ts';

// porta da API em dev (scripts/dev.mjs sobe a API nela e repassa pra cá)
const API_PORT = Number(process.env.API_PORT) || 3001;
const API_PREFIXES = ['/api/', '/analyze', '/chat'];

/**
 * Dev: o Vite é um app de duas páginas (index.html = landing, app.html = portal). As rotas do portal
 * (/projects, /team…) não existem como arquivo, então caem no app.html — o mesmo que o servidor faz no build.
 */
function portalFallback(): Plugin {
  return {
    name: 'shieldepy-portal-fallback',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.method !== 'GET' || !req.url) return next();
        const url = new URL(req.url, 'http://localhost');
        if (API_PREFIXES.some((p) => url.pathname.startsWith(p))) return next();
        const legacy = legacyRedirect(url);
        if (legacy) {
          res.writeHead(301, { location: legacy });
          res.end();
          return;
        }
        // arquivo, módulo do Vite (/@vite, /src/…, /node_modules/…) ou a landing: segue normal
        if (url.pathname === '/' || url.pathname.includes('.') || url.pathname.startsWith('/@') || url.pathname.startsWith('/src/') || url.pathname.startsWith('/node_modules/')) return next();
        req.url = '/app.html';
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), portalFallback()],
  appType: 'mpa',
  server: {
    port: 5173,
    proxy: Object.fromEntries(API_PREFIXES.map((p) => [p, { target: `http://localhost:${API_PORT}` }])),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: { index: 'index.html', app: 'app.html' },
      // React num chunk próprio: landing e portal compartilham o mesmo arquivo em cache
      output: {
        manualChunks: (id) => (/\/node_modules\/(react|react-dom|scheduler)\//.test(id) ? 'react' : undefined),
      },
    },
  },
});

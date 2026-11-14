// Gerado por scripts/squarecloud/montar.mjs (decisão 0048). Variáveis do painel da Square Cloud
// passam por cima destes padrões.
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
process.env.PORT ??= '80';
process.env.HOST ??= '0.0.0.0';
process.env.NODE_ENV ??= 'production';
process.env.SHIELDEPY_STATIC_DIR ??= here('./public');
process.env.SHIELDEPY_DATA_DIR ??= here('./data');
process.env.PUBLIC_URL ??= 'https://shieldepy.squareweb.app';

await import('./src/scripts/startProd.ts');

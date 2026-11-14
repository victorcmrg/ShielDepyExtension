// Monta o pacote da Square Cloud numa pasta pronta para virar uma branch de deploy. Dois modos:
//
//   node scripts/squarecloud/montar.mjs <pasta>            o site estático (padrão; decisão 0049): a landing,
//       a encenação do /entrar e o pós-login de demonstração (/demo), com dados de mentira e sem API.
//       É o que o app atual da Square Cloud (criado como site estático) roda, na branch `squarecloud`.
//   node scripts/squarecloud/montar.mjs <pasta> --portal   o portal de verdade (decisão 0048): a API (apps/api,
//       que não importa o motor) servindo o site, com o PGlite em data/. Precisa de um app em Node.
//
// --sem-build usa o apps/web/dist que já existe (cuidado: ele tem que ter sido gerado no mesmo modo).
// A pasta pode já ser um clone da branch: o .git dela fica; o resto é trocado (menos data/ e node_modules/).
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const outArg = args.find((a) => !a.startsWith('--'));
if (!outArg) {
  console.error('uso: node scripts/squarecloud/montar.mjs <pasta> [--portal] [--sem-build]');
  process.exit(1);
}
const OUT = resolve(outArg);
const PORTAL = args.includes('--portal');
const API = join(ROOT, 'apps', 'api');
const WEB_DIST = join(ROOT, 'apps', 'web', 'dist');

// no modo estático o build liga a demonstração (o "Entrar" vai para /demo, sem chamar a API)
if (!args.includes('--sem-build'))
  execSync('npm run build -w @shieldepy/web', { cwd: ROOT, stdio: 'inherit', env: { ...process.env, VITE_DEMO_PORTAL: PORTAL ? '' : '1' } });
if (!existsSync(join(WEB_DIST, 'index.html'))) {
  console.error(`build do site não encontrado em ${WEB_DIST}`);
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });
// troca tudo menos o .git (o clone da branch), o data/ (o banco, se alguém montar em cima de um em uso) e o
// node_modules (fora do git; poupa reinstalar quando se testa o pacote na máquina)
const KEEP = new Set(['.git', 'data', 'node_modules']);
for (const name of readdirSync(OUT)) if (!KEEP.has(name)) rmSync(join(OUT, name), { recursive: true, force: true });

if (!PORTAL) {
  // o site estático: a landing na raiz e o portal (app.html) em cada rota que ele desenha sem API, para
  // abrir direto ou depois de um reload (o servidor estático não tem o fallback da API)
  cpSync(WEB_DIST, OUT, { recursive: true });
  const app = readFileSync(join(OUT, 'app.html'));
  for (const route of ['entrar', 'demo', 'login']) {
    mkdirSync(join(OUT, route), { recursive: true });
    writeFileSync(join(OUT, route, 'index.html'), app);
  }
  rmSync(join(OUT, 'app.html'));
  writeFileSync(
    join(OUT, 'squarecloud.app'),
    ['DISPLAY_NAME=ShielDepy', 'DESCRIPTION=Landing do ShielDepy', 'MAIN=index.html', 'RUNTIME=static', 'MEMORY=512', 'VERSION=recommended', 'SUBDOMAIN=shieldepy', ''].join('\n')
  );
  writeFileSync(
    join(OUT, 'README.md'),
    `# Branch de deploy da Square Cloud

A landing do ShielDepy, a encenação do \`/entrar\` e o pós-login de demonstração (\`/demo\`, com empresas e
funcionários de exemplo, sem sistema por trás), como site estático. Gerado por \`scripts/squarecloud/montar.mjs\`
na \`main\` (decisões 0048 e 0049). Não edite aqui: o código-fonte fica na \`main\`.
`
  );
  console.log(`site estático (com a demonstração) montado em ${OUT}`);
  process.exit(0);
}

cpSync(join(API, 'src'), join(OUT, 'src'), { recursive: true });
cpSync(join(API, 'drizzle'), join(OUT, 'drizzle'), { recursive: true });
cpSync(WEB_DIST, join(OUT, 'public'), { recursive: true });

// as dependências da API, nas versões instaladas aqui (o que os testes rodaram)
const apiPkg = JSON.parse(readFileSync(join(API, 'package.json'), 'utf8'));
const installed = (dep) => {
  for (const base of [join(API, 'node_modules'), join(ROOT, 'node_modules')]) {
    const p = join(base, dep, 'package.json');
    if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8')).version;
  }
  return apiPkg.dependencies[dep];
};
const rootPkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const pkg = {
  name: 'shieldepy-web',
  private: true,
  type: 'module',
  description: 'O site e o portal do ShielDepy na Square Cloud (gerado por scripts/squarecloud/montar.mjs).',
  engines: rootPkg.engines,
  scripts: { start: 'node --import tsx start.mjs' },
  dependencies: Object.fromEntries(Object.keys(apiPkg.dependencies).sort().map((d) => [d, installed(d)])),
};
writeFileSync(join(OUT, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);

// a subida: os padrões da Square Cloud (porta 80 em 0.0.0.0, produção, o site em public/, o banco em data/) e o
// start:prod da API (o admin pelas variáveis de ambiente e o servidor)
writeFileSync(
  join(OUT, 'start.mjs'),
  `// Gerado por scripts/squarecloud/montar.mjs (decisão 0048). Variáveis do painel da Square Cloud
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
`
);

writeFileSync(
  join(OUT, 'squarecloud.app'),
  [
    'DISPLAY_NAME=ShielDepy',
    'DESCRIPTION=Site e portal do ShielDepy',
    // o tipo do app não muda depois do primeiro deploy (precisa de um app novo): declarado, não deduzido
    'RUNTIME=nodejs',
    'MAIN=start.mjs',
    'MEMORY=512',
    'VERSION=recommended',
    'SUBDOMAIN=shieldepy',
    'AUTORESTART=true',
    'START=node --import tsx start.mjs',
    '',
  ].join('\n')
);

writeFileSync(join(OUT, '.gitignore'), 'node_modules/\ndata/\n');

writeFileSync(
  join(OUT, 'README.md'),
  `# Branch de deploy da Square Cloud

O site e o portal do ShielDepy rodando de verdade: a API (\`src/\`, copiada de \`apps/api/src\`) serve o build do
site (\`public/\`) e guarda as contas no PGlite em \`data/\`. Gerado por \`scripts/squarecloud/montar.mjs\` na \`main\`
(decisão 0048). Não edite aqui: o código-fonte fica na \`main\`.

Variáveis no painel da Square Cloud:
- \`ADMIN_EMAIL\` e \`ADMIN_INITIAL_PASSWORD\` (8+ caracteres): o admin da plataforma, criado na primeira subida.
- Opcionais: \`DATABASE_URL\` (Postgres em vez do PGlite), \`GOOGLE_CLIENT_ID\`/\`GOOGLE_CLIENT_SECRET\`,
  \`GITHUB_CLIENT_ID\`/\`GITHUB_CLIENT_SECRET\` e \`OAUTH_REDIRECT_BASE\` (login social).
`
);

console.log(`pacote da Square Cloud montado em ${OUT}`);

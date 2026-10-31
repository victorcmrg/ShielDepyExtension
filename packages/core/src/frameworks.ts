// Os frameworks HTTP que o mapa ainda não lê (C2f, MVP3). Sem isso, um projeto Koa ou Hono dava
// 0 rotas, o caos não testava nada e saía verde: um falso "aguentou" silencioso. O motor só olha as
// dependências do package.json (texto JSON, não código): saber que o framework está lá basta para avisar.

/**
 * Pacote → nome do framework, para os que o mapa não lê. Sai daqui o que passar a ser lido (o Fastify saiu na MVP4). O NestJS não
 * está aqui: as rotas dele saem dos decorators (`@Controller`, `@Post`), como as do routing-controllers.
 */
export const UNSUPPORTED_FRAMEWORKS: Readonly<Record<string, string>> = {
  koa: 'Koa',
  hono: 'Hono',
  next: 'Next.js',
  '@hapi/hapi': 'hapi',
  restify: 'Restify',
};

/**
 * Os frameworks que o mapa lê. Com um deles e 0 rotas, o padrão de registro do projeto ficou fora do alcance
 * (MVP8: rotas num objeto registradas num laço, `for (const r of routes) app.route(r)`), e o caos também não
 * prova nada: sem isto, tirar o Fastify da lista acima (MVP4) traria de volta o verde falso.
 */
export const SUPPORTED_FRAMEWORKS: Readonly<Record<string, string>> = {
  express: 'Express',
  fastify: 'Fastify',
  '@nestjs/core': 'NestJS',
};

/** Os frameworks lidos pelo mapa nas dependências de um `package.json` (texto), em ordem de nome. */
export function supportedFrameworks(packageJson: string | undefined): string[] {
  return frameworksIn(packageJson, SUPPORTED_FRAMEWORKS);
}

/** Os frameworks não suportados nas dependências de um `package.json` (texto), em ordem de nome. */
export function unsupportedFrameworks(packageJson: string | undefined): string[] {
  return frameworksIn(packageJson, UNSUPPORTED_FRAMEWORKS);
}

function frameworksIn(packageJson: string | undefined, known: Readonly<Record<string, string>>): string[] {
  let pkg: { dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown>; peerDependencies?: Record<string, unknown> };
  try {
    pkg = JSON.parse(packageJson ?? '') as typeof pkg;
  } catch {
    return [];
  }
  // as de desenvolvimento entram: um app Next costuma ter tudo em dependencies, mas há quem ponha o servidor em devDependencies
  const deps = { ...pkg.devDependencies, ...pkg.peerDependencies, ...pkg.dependencies };
  return [...new Set(Object.keys(deps).filter((d) => d in known).map((d) => known[d]!))].sort();
}

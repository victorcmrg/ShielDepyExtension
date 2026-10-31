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

/** Os frameworks não suportados nas dependências de um `package.json` (texto), em ordem de nome. */
export function unsupportedFrameworks(packageJson: string | undefined): string[] {
  let pkg: { dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown>; peerDependencies?: Record<string, unknown> };
  try {
    pkg = JSON.parse(packageJson ?? '') as typeof pkg;
  } catch {
    return [];
  }
  // as de desenvolvimento entram: um app Next costuma ter tudo em dependencies, mas há quem ponha o servidor em devDependencies
  const deps = { ...pkg.devDependencies, ...pkg.peerDependencies, ...pkg.dependencies };
  return [...new Set(Object.keys(deps).filter((d) => d in UNSUPPORTED_FRAMEWORKS).map((d) => UNSUPPORTED_FRAMEWORKS[d]!))].sort();
}

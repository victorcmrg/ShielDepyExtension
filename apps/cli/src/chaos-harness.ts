// O arnês de teste embutido (MVP2): os testes de caos importam o Vitest, o supertest e o MSW, e o banco
// gerado (chaos/db.ts) importa o PGlite. Quando o projeto não os tem, a CLI empresta os dela, sem
// instalar nada no alvo: cada pacote que falta vira um link (junction no Windows) em
// `.shieldepy/chaos-tests/node_modules`, a pasta que o ShielDepy apaga e regera a cada rodada (o `rm`
// recursivo apaga o link, não o pacote). Os testes gerados e o vitest.config.ts moram ali, então o
// `import` deles acha o pacote pela resolução normal do Node. O que está fora dali (o chaos/setup.ts
// importa o `vi`; o chaos/db.ts, o PGlite) recebe um alias no vitest.config.ts gerado.

import { existsSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHAOS_TESTS_DIR } from '@shieldepy/agent/chaos';

/** O que os testes gerados importam: sem um deles no projeto nem no arnês, não há como rodar. */
export const HARNESS_PACKAGES = ['vitest', 'supertest', 'msw'];
/** O que só o banco gerado usa: emprestado se o arnês tiver; senão, o --init pede para instalar. */
export const HARNESS_DB_PACKAGES = ['@electric-sql/pglite', '@electric-sql/pglite-socket'];

export interface ChaosHarness {
  /** Os pacotes que o projeto não tem, emprestados do arnês, e a pasta de cada um (com o package.json). */
  borrowed: Record<string, string>;
}

/** A pasta do pacote `name` visível a partir do diretório `from`, subindo pelos node_modules como o Node. */
export function packageDir(name: string, from: string): string | undefined {
  try {
    return path.dirname(createRequire(path.join(from, 'noop.js')).resolve(`${name}/package.json`));
  } catch {
    // o `exports` do pacote não expõe o package.json: procura a pasta
    for (let dir = path.resolve(from); ; dir = path.dirname(dir)) {
      const candidate = path.join(dir, 'node_modules', name);
      if (existsSync(path.join(candidate, 'package.json'))) return candidate;
      if (path.dirname(dir) === dir) return undefined;
    }
  }
}

/**
 * A pasta do arnês da CLI (a do pacote `@shieldepy/cli`, com as dependências dela). No bundle CommonJS da
 * extensão não há `import.meta.url`: lá não há arnês, e o caos usa o do projeto, como antes.
 */
export function defaultHarnessDir(): string | undefined {
  const url = (import.meta as { url?: string }).url;
  return typeof url === 'string' && url.startsWith('file:') ? path.dirname(path.dirname(fileURLToPath(url))) : undefined;
}

/**
 * O que falta no projeto e o arnês tem. `undefined`: o projeto tem o essencial (Vitest, supertest, MSW)
 * e o banco, ou o arnês não tem o essencial que falta (aí vale o erro de sempre, "o Vitest não está
 * instalado").
 */
export function chaosHarness(root: string, harnessDir: string | undefined): ChaosHarness | undefined {
  if (!harnessDir) return undefined;
  const borrowed: Record<string, string> = {};
  for (const name of [...HARNESS_PACKAGES, ...HARNESS_DB_PACKAGES]) {
    // só o node_modules da raiz do projeto conta (como no vitestEntry): num monorepo com os pacotes
    // içados mais acima, o link na pasta dos testes vem antes, e o caos usa os do arnês
    if (existsSync(path.join(root, 'node_modules', name, 'package.json'))) continue;
    const dir = packageDir(name, harnessDir);
    if (dir) borrowed[name] = dir;
    else if (HARNESS_PACKAGES.includes(name)) return undefined;
  }
  return Object.keys(borrowed).length ? { borrowed } : undefined;
}

/** Os links em `.shieldepy/chaos-tests/node_modules`, um por pacote emprestado. */
export function linkHarness(root: string, harness: ChaosHarness): void {
  for (const [name, dir] of Object.entries(harness.borrowed)) {
    const link = path.join(root, CHAOS_TESTS_DIR, 'node_modules', name);
    rmSync(link, { recursive: true, force: true });
    mkdirSync(path.dirname(link), { recursive: true });
    symlinkSync(dir, link, 'junction');
  }
}

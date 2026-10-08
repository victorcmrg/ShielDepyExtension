import * as path from 'node:path';

const CODE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];

/**
 * Resolve um especificador de import relativo (`./b`, `../lib`, `./b.js`) para o caminho do
 * arquivo real em disco, do mesmo jeito que o TypeScript/bundler faria: caminho exato,
 * extensões de código, `index.*` de diretório, e `.js` → `.ts` (imports ESM escritos com a
 * extensão de saída). Pacotes (não relativos) e arquivos inexistentes retornam `undefined`.
 * `exists` é injetado pra função ser pura e testável.
 */
export function resolveImport(fromFile: string, spec: string, exists: (candidate: string) => boolean): string | undefined {
  if (!spec.startsWith('.')) return undefined;
  return resolveFile(path.join(path.dirname(fromFile), spec), exists);
}

/** Resolve um caminho-base (sem ou com extensão) para um arquivo de código existente. */
export function resolveFile(basePath: string, exists: (candidate: string) => boolean): string | undefined {
  const base = path.normalize(basePath);
  const candidates: string[] = [];

  const ext = path.extname(base);
  if (ext === '.js' || ext === '.jsx' || ext === '.mjs' || ext === '.cjs') {
    // Fonte TS primeiro: `./b.js` num projeto TS quase sempre aponta pra `b.ts`.
    const stem = base.slice(0, -ext.length);
    candidates.push(stem + (ext === '.jsx' ? '.tsx' : ext === '.mjs' ? '.mts' : ext === '.cjs' ? '.cts' : '.ts'));
  }
  candidates.push(base);
  for (const e of CODE_EXTENSIONS) candidates.push(base + e);
  for (const e of CODE_EXTENSIONS) candidates.push(path.join(base, 'index' + e));

  return candidates.find((c) => path.extname(c) !== '' && exists(c));
}

/** Nome do pacote de um especificador não relativo: `@a/b/c` → `@a/b`, `lodash/fp` → `lodash`, `node:fs` → `node:fs`. */
export function packageName(spec: string): string {
  if (spec.startsWith('node:')) return spec;
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;
}

export type ModuleTarget = { kind: 'file'; path: string } | { kind: 'package'; name: string } | { kind: 'unresolved' };

/** O mínimo de disco que o resolvedor precisa — o core continua sem depender de `fs` direto. */
export interface ResolverFs {
  isFile(fsPath: string): boolean;
  readFile?(fsPath: string): string | undefined;
}

interface PathsConfig {
  /** Diretório base dos `paths` (baseUrl, ou o diretório do tsconfig). */
  pathsBase: string;
  baseUrl?: string;
  paths: Array<{ prefix: string; suffix: string; wildcard: boolean; targets: string[] }>;
}

const CONFIG_FILES = ['tsconfig.json', 'jsconfig.json'];

/** JSON com comentários e vírgulas finais (formato do tsconfig). Um passo só, ciente de strings. */
export function parseJsonc(text: string): unknown {
  let out = '';
  let inString = false;
  // posição em `out` de uma vírgula ainda sem valor depois dela (candidata a vírgula final)
  let pendingComma = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      out += ch;
      if (ch === '\\') out += text[++i] ?? '';
      else if (ch === '"') inString = false;
    } else if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (ch === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i + 2);
      if (i < 0) break;
      i++;
    } else if (ch === '}' || ch === ']') {
      if (pendingComma >= 0) out = out.slice(0, pendingComma) + out.slice(pendingComma + 1);
      pendingComma = -1;
      out += ch;
    } else {
      if (ch === ',') pendingComma = out.length;
      else if (ch !== ' ' && ch !== '\t' && ch !== '\n' && ch !== '\r') pendingComma = -1;
      if (ch === '"') inString = true;
      out += ch;
    }
  }
  return JSON.parse(out);
}

/**
 * Resolvedor de módulos com cache: relativos, `paths`/`baseUrl` do tsconfig (o mais próximo
 * subindo a árvore, seguindo `extends` relativo) e, por exclusão, pacotes.
 */
export class ModuleResolver {
  private readonly configByDir = new Map<string, PathsConfig | null>();

  constructor(private readonly fs: ResolverFs) {}

  resolve(fromFile: string, spec: string): ModuleTarget {
    const exists = (p: string) => this.fs.isFile(p);
    if (spec.startsWith('.') || path.isAbsolute(spec)) {
      const file = spec.startsWith('.') ? resolveImport(fromFile, spec, exists) : resolveFile(spec, exists);
      return file ? { kind: 'file', path: file } : { kind: 'unresolved' };
    }
    const config = this.configFor(path.dirname(fromFile));
    if (config) {
      for (const p of config.paths) {
        if (!(p.wildcard ? spec.startsWith(p.prefix) && spec.endsWith(p.suffix) && spec.length >= p.prefix.length + p.suffix.length : spec === p.prefix)) continue;
        const star = p.wildcard ? spec.slice(p.prefix.length, spec.length - p.suffix.length) : '';
        for (const target of p.targets) {
          const file = resolveFile(path.resolve(config.pathsBase, target.replace('*', star)), exists);
          if (file) return { kind: 'file', path: file };
        }
        // casou com um alias do projeto mas não achou arquivo: é import quebrado, não pacote
        return { kind: 'unresolved' };
      }
      if (config.baseUrl) {
        const file = resolveFile(path.resolve(config.baseUrl, spec), exists);
        if (file) return { kind: 'file', path: file };
      }
    }
    return { kind: 'package', name: packageName(spec) };
  }

  /** Esquece os tsconfig lidos (ex: o arquivo de configuração mudou). */
  invalidate(): void {
    this.configByDir.clear();
  }

  private configFor(dir: string): PathsConfig | null {
    const cached = this.configByDir.get(dir);
    if (cached !== undefined) return cached;
    let result: PathsConfig | null = null;
    const file = CONFIG_FILES.map((f) => path.join(dir, f)).find((f) => this.fs.isFile(f));
    if (file) result = this.loadConfig(file, new Set());
    else {
      const parent = path.dirname(dir);
      if (parent !== dir) result = this.configFor(parent);
    }
    this.configByDir.set(dir, result);
    return result;
  }

  private loadConfig(file: string, seen: Set<string>): PathsConfig | null {
    if (seen.has(file) || !this.fs.readFile) return null;
    seen.add(file);
    let json: { extends?: unknown; compilerOptions?: { baseUrl?: unknown; paths?: unknown } };
    try {
      const text = this.fs.readFile(file);
      if (text === undefined) return null;
      json = parseJsonc(text) as typeof json;
    } catch {
      return null;
    }
    const dir = path.dirname(file);
    let inherited: PathsConfig | null = null;
    if (typeof json.extends === 'string' && json.extends.startsWith('.')) {
      const parentFile = path.resolve(dir, json.extends.endsWith('.json') ? json.extends : json.extends + '.json');
      inherited = this.loadConfig(parentFile, seen);
    }

    const options = json.compilerOptions ?? {};
    const baseUrl = typeof options.baseUrl === 'string' ? path.resolve(dir, options.baseUrl) : inherited?.baseUrl;
    const rawPaths = options.paths && typeof options.paths === 'object' ? (options.paths as Record<string, unknown>) : undefined;
    if (!rawPaths) return inherited || baseUrl ? { pathsBase: inherited?.pathsBase ?? dir, baseUrl, paths: inherited?.paths ?? [] } : null;

    const paths = Object.entries(rawPaths)
      .filter((entry): entry is [string, string[]] => Array.isArray(entry[1]))
      .map(([pattern, targets]) => {
        const starAt = pattern.indexOf('*');
        return {
          prefix: starAt < 0 ? pattern : pattern.slice(0, starAt),
          suffix: starAt < 0 ? '' : pattern.slice(starAt + 1),
          wildcard: starAt >= 0,
          targets: targets.filter((t) => typeof t === 'string'),
        };
      })
      // padrão mais específico primeiro, como o TypeScript faz
      .sort((a, b) => b.prefix.length - a.prefix.length);
    return { pathsBase: baseUrl ?? dir, baseUrl, paths };
  }
}

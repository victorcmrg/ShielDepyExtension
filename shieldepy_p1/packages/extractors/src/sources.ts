import { readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { parseRules, type Rule } from '@shieldepy/core';
import type { Registry } from './registry';
import { scanDir, scanSources, type SourceFile } from './scan';
import { toRules } from './translate';
import type { ServiceRule } from './types';

export interface LoadedRules {
  label: string;
  rules: Rule[];
  /** Arquivos ignorados (extensão sem extrator, JSON inválido…) e o motivo. */
  skipped: string[];
}

/**
 * Carrega regras de um caminho — o que a CLI recebe como argumento:
 *   pasta          → varre com o extrator de cada extensão (serviço = 1ª subpasta)
 *   arquivo .json  → fixture `Rule[]` (validada)
 *   arquivo código → extrator da extensão
 */
export function loadRulesFromPath(target: string, registry: Registry): LoadedRules {
  const stat = statSync(target);
  if (stat.isDirectory()) {
    const items = scanDir(target, registry);
    return { label: target, rules: toRules(items), skipped: [] };
  }
  return loadRulesFromFiles([{ name: target, content: readFileSync(target, 'utf8') }], registry);
}

/** Mesma coisa pra arquivos em memória (upload da web). JSON inválido vai pra `skipped`, não derruba. */
export function loadRulesFromFiles(files: SourceFile[], registry: Registry): LoadedRules {
  const fixtures: Rule[] = [];
  const skipped: string[] = [];
  const items: ServiceRule[] = [];

  // Arquivo por arquivo, na ordem recebida — `skipped` sai na mesma ordem que o usuário mandou.
  for (const f of files) {
    if (path.extname(f.name).toLowerCase() === '.json') {
      try {
        fixtures.push(...parseRules(JSON.parse(f.content)));
      } catch (err) {
        skipped.push(`${f.name} (${err instanceof Error ? err.message : 'JSON inválido'})`);
      }
      continue;
    }
    const scanned = scanSources([f], registry);
    items.push(...scanned.items);
    skipped.push(...scanned.skipped.map((name) => `${name} (extensão não suportada)`));
  }

  const analyzed = files.length - skipped.length;
  return { label: `${analyzed} arquivo(s) analisado(s)`, rules: [...toRules(items), ...fixtures], skipped };
}

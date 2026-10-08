import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { toFileId, walkSourceTree } from '@shieldepy/core';
import type { Registry } from './registry';
import type { ServiceRule } from './types';

/** Nome do "serviço" a partir de um nome de arquivo (ex.: "PricingHandler.cs" -> "PricingHandler"). */
export function serviceFromFileName(name: string): string {
  const base = path.basename(name.replace(/\\/g, '/')).replace(/\.[^.]+$/, '');
  return base || name;
}

/**
 * Varre uma pasta de serviços e aplica o extrator de cada arquivo (escolhido pela extensão).
 * Nome do serviço = a primeira subpasta abaixo da raiz
 * (services/pricing/PricingListener.java -> "pricing"); arquivo solto na raiz usa o próprio nome.
 */
export function scanDir(root: string, registry: Registry): ServiceRule[] {
  const out: ServiceRule[] = [];
  for (const rel of walkSourceTree(root)) {
    const segments = rel.split(/[\\/]/);
    const extractor = registry.forPath(rel);
    if (!extractor) continue;
    const full = path.join(root, rel);
    const service = segments.length > 1 ? segments[0]! : serviceFromFileName(rel);
    const source = readFileSync(full, 'utf8');
    for (const r of extractor.parse(source, full)) out.push({ ...r, service, file: toFileId(full) });
  }
  return out;
}

/** Um arquivo em memória (upload da web, buffer do editor). */
export interface SourceFile {
  name: string;
  content: string;
}

/** Mesma coisa do `scanDir`, pra arquivos que não estão em disco. Devolve também os ignorados. */
export function scanSources(files: SourceFile[], registry: Registry): { items: ServiceRule[]; skipped: string[] } {
  const items: ServiceRule[] = [];
  const skipped: string[] = [];
  for (const f of files) {
    const extractor = registry.forPath(f.name);
    if (!extractor) {
      skipped.push(f.name);
      continue;
    }
    const service = serviceFromFileName(f.name);
    for (const r of extractor.parse(f.content, f.name)) items.push({ ...r, service, file: f.name });
  }
  return { items, skipped };
}

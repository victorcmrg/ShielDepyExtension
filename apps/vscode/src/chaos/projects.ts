// De qual projeto de caos é uma rota do mapa. Puro, sem `vscode`: testável e usado pelo ChaosCommand.
import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { isChaosSource, isProjectManifest } from '@shieldepy/core';

/**
 * A pasta do projeto com o arquivo: o `package.json` de projeto mais perto, sem subir além de `top`,
 * pela mesma regra do `shieldepy chaos` (0034). Rota de C# ou Java não tem caos: subindo daqui, ela
 * cairia na raiz do repositório e a raiz viraria um projeto a testar.
 */
export function chaosProjectOf(file: string, top: string): string | undefined {
  if (!isChaosSource(file)) return undefined;
  for (let dir = path.dirname(file); ; dir = path.dirname(dir)) {
    const manifest = path.join(dir, 'package.json');
    const atTop = path.relative(top, dir) === '';
    if (existsSync(manifest) && (atTop || isProjectManifest(readFileSync(manifest, 'utf8')))) return dir;
    if (atTop || path.dirname(dir) === dir) return undefined;
  }
}

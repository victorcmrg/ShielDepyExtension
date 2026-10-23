// Medição do custo real da IA no pipeline de caos (E5/5e). FAZ CHAMADAS PAGAS à API da Anthropic:
// só roda com ANTHROPIC_API_KEY definida E com --sim-gastar na linha de comando.
//
//   ANTHROPIC_API_KEY=... npm run measure:chaos -- --sim-gastar
//
// Para cada exemplo e cada modelo do Threat Modeler (tier deep), roda `shieldepy chaos` completo
// (gera, roda os testes e escreve o relatório, então o parágrafo da IA também entra quando há
// achado). Os especialistas ficam no tier fast (Haiku 4.5). Imprime uma tabela e grava o JSON
// completo em .shieldepy/measure-chaos-cost.json, para colar no plano.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../apps/cli/src/main';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const EXAMPLES = ['checkout-express', 'checkout-express-fixed'];
const DEEP_MODELS = ['claude-haiku-4-5', 'claude-sonnet-5-5'];
const FAST_MODEL = 'claude-haiku-4-5';

if (!process.argv.includes('--sim-gastar')) {
  console.error('Este script faz chamadas PAGAS à API. Rode de novo com --sim-gastar para confirmar.');
  process.exit(2);
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.error('Falta ANTHROPIC_API_KEY.');
  process.exit(2);
}

interface Row {
  example: string;
  deep: string;
  exit: number;
  engine: string;
  hypotheses: number;
  fromAi: number;
  rejected: number;
  errors: string[];
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  usd: number;
  seconds: number;
}

const rows: Row[] = [];
for (const example of EXAMPLES) {
  for (const deep of DEEP_MODELS) {
    const dir = path.join(ROOT, 'examples', example);
    const out: string[] = [];
    const started = Date.now();
    const env = { ...process.env, SHIELDEPY_DEEP_MODEL: deep, SHIELDEPY_FAST_MODEL: FAST_MODEL };
    const reportFile = path.join(ROOT, '.shieldepy', `measure-${example}-${deep}.md`);
    const exit = await main(['chaos', dir, '--json', '--report', reportFile], { out: (l) => out.push(l), err: () => {}, env });
    const r = JSON.parse(out.join('\n'));
    rows.push({
      example,
      deep,
      exit,
      engine: r.engine,
      hypotheses: r.hypotheses.length,
      fromAi: r.hypotheses.filter((h: { source: string }) => h.source !== 'motor').length,
      rejected: r.rejected.length,
      errors: r.errors,
      calls: r.cost.calls,
      inputTokens: r.cost.inputTokens,
      outputTokens: r.cost.outputTokens,
      cacheReadTokens: r.cost.cacheReadTokens,
      usd: r.cost.usd,
      seconds: Math.round((Date.now() - started) / 1000),
    });
    rmSync(path.join(dir, '.shieldepy'), { recursive: true, force: true });
    console.error(`✓ ${example} com deep=${deep}`);
  }
}

console.log('\n| exemplo | deep | exit | hipóteses (da IA) | descartadas | erros | chamadas | entrada | saída | cache | US$ | s |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  console.log(
    `| ${r.example} | ${r.deep} | ${r.exit} | ${r.hypotheses} (${r.fromAi}) | ${r.rejected} | ${r.errors.length} | ${r.calls} | ${r.inputTokens} | ${r.outputTokens} | ${r.cacheReadTokens} | ${r.usd.toFixed(4)} | ${r.seconds} |`
  );
}
const total = rows.reduce((n, r) => n + r.usd, 0);
console.log(`\ntotal gasto nesta medição: US$ ${total.toFixed(4)}`);
for (const r of rows) for (const e of r.errors) console.log(`erro (${r.example}, ${r.deep}): ${e}`);

mkdirSync(path.join(ROOT, '.shieldepy'), { recursive: true });
writeFileSync(path.join(ROOT, '.shieldepy', 'measure-chaos-cost.json'), JSON.stringify(rows, null, 2));
console.log('JSON completo e relatórios em .shieldepy/ (fora do git).');

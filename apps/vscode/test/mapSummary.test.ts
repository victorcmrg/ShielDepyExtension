import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CodeGraph, silentHost } from '@shieldepy/core';
import { defaultWasmDir } from '@shieldepy/core/wasm-path';
import { summarizeMap } from '../src/workspace/mapSummary';

let dir: string;
let graph: CodeGraph;

const write = (rel: string, content: string) => {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  graph.updateFile(full, content);
};

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shieldepy-map-'));
  graph = await CodeGraph.create(defaultWasmDir(), silentHost);
});

afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

// M6: o resumo que a extensão mostra quando termina de mapear o projeto aberto.
describe('M6 — resumo do mapa ao abrir o projeto', () => {
  it('conta arquivos, rotas, rotas sensíveis, operações e a % de chamadas provadas', () => {
    write('db.js', "const { Pool } = require('pg');\nmodule.exports = new Pool();\n");
    write(
      'routes.js',
      [
        "const router = require('express').Router();",
        "const pool = require('./db');",
        "function health() { return 'ok'; }",
        "router.get('/health', (req, res) => res.send(health()));",
        "router.post('/orders', async (req, res) => { await pool.query('SELECT q FROM stock'); await pool.query('UPDATE stock SET q = q - 1'); res.end(); });",
        'module.exports = router;',
      ].join('\n')
    );
    write('app.js', "const express = require('express');\nconst app = express();\napp.use('/api', require('./routes'));\n");
    expect(summarizeMap(graph, [], dir)).toEqual({ files: 3, routes: 2, sensitive: 1, operations: 2, proven: 100, weak: 0 });
  });

  it('projeto sem rota nem chamada interna: 100% provado, nada a testar', () => {
    write('util.ts', 'export const sum = (a: number, b: number) => a + b;\n');
    expect(summarizeMap(graph, [], dir)).toEqual({ files: 1, routes: 0, sensitive: 0, operations: 0, proven: 100, weak: 0 });
  });
});

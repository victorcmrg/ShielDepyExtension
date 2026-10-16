#!/usr/bin/env node
// Ponto de entrada instalável: registra o tsx (TS sem build) e roda a CLI.
import { register } from 'tsx/esm/api';

register();
const { main } = await import('../src/main.ts');
process.exitCode = await main(process.argv.slice(2));

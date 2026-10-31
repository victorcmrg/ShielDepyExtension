import { describe, expect, it } from 'vitest';
import { unsupportedFrameworks } from '../src';

describe('C2f (MVP3) — frameworks que o mapa não lê', () => {
  it('acha nas dependências (inclusive as de desenvolvimento), sem repetir e em ordem', () => {
    const pkg = JSON.stringify({ dependencies: { '@nestjs/core': '10', express: '4', fastify: '4' }, devDependencies: { next: '14' }, peerDependencies: { fastify: '4' } });
    // o NestJS fica de fora: o mapa lê as rotas dele pelos decorators
    expect(unsupportedFrameworks(pkg)).toEqual(['Fastify', 'Next.js']);
  });

  it('Express, sem package.json ou com JSON inválido: nada a avisar', () => {
    expect(unsupportedFrameworks(JSON.stringify({ dependencies: { express: '4', pg: '8' } }))).toEqual([]);
    expect(unsupportedFrameworks(undefined)).toEqual([]);
    expect(unsupportedFrameworks('{ isto não é json')).toEqual([]);
  });
});

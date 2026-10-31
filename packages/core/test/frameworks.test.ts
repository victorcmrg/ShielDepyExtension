import { describe, expect, it } from 'vitest';
import { supportedFrameworks, unsupportedFrameworks } from '../src';

describe('C2f (MVP3) — frameworks que o mapa não lê', () => {
  it('acha nas dependências (inclusive as de desenvolvimento), sem repetir e em ordem', () => {
    const pkg = JSON.stringify({ dependencies: { '@nestjs/core': '10', express: '4', fastify: '4', koa: '2' }, devDependencies: { next: '14' }, peerDependencies: { koa: '2' } });
    // o NestJS e o Fastify (MVP4) ficam de fora: o mapa lê as rotas deles
    expect(unsupportedFrameworks(pkg)).toEqual(['Koa', 'Next.js']);
  });

  it('os que o mapa lê (MVP8: com 0 rotas, o caos também não prova nada)', () => {
    expect(supportedFrameworks(JSON.stringify({ dependencies: { express: '4', fastify: '5' }, devDependencies: { '@nestjs/core': '10', koa: '2' } }))).toEqual(['Express', 'Fastify', 'NestJS']);
    expect(supportedFrameworks(undefined)).toEqual([]);
  });

  it('Express, sem package.json ou com JSON inválido: nada a avisar', () => {
    expect(unsupportedFrameworks(JSON.stringify({ dependencies: { express: '4', pg: '8' } }))).toEqual([]);
    expect(unsupportedFrameworks(undefined)).toEqual([]);
    expect(unsupportedFrameworks('{ isto não é json')).toEqual([]);
  });
});

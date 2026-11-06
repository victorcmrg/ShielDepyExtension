import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chaosProjectOf, contractCreatedMessage } from '../src/chaos/projects';

let top: string;
const write = (rel: string, content = '') => {
  fs.mkdirSync(path.dirname(path.join(top, rel)), { recursive: true });
  fs.writeFileSync(path.join(top, rel), content);
  return path.join(top, rel);
};

beforeEach(() => {
  top = fs.mkdtempSync(path.join(os.tmpdir(), 'shieldepy-proj-'));
  write('package.json', '{ "name": "raiz" }');
});
afterEach(() => fs.rmSync(top, { recursive: true, force: true }));

describe('o aviso de contrato criado', () => {
  it('diz que saiu do mapa, sem IA, e o que vem depois', () => {
    expect(contractCreatedMessage(0)).toBe('ShielDepy: contrato criado a partir do mapa, sem IA. Sem pendências: seguindo para o teste.');
    expect(contractCreatedMessage(2)).toMatch(/sem IA\. Falta completar 2 linha\(s\) marcada\(s\) com TODO\(shieldepy\); depois, rode "Testar Caos" de novo\.$/);
  });
});

describe('o projeto de caos de uma rota', () => {
  it('a rota JS/TS fica no package.json mais perto', () => {
    write('examples/loja/package.json', '{ "name": "loja" }');
    expect(chaosProjectOf(write('examples/loja/src/routes.ts'), top)).toBe(path.join(top, 'examples', 'loja'));
    expect(chaosProjectOf(write('src/routes.ts'), top)).toBe(top);
  });

  it('rota de C# ou Java não conta: sem isso, a raiz do repositório vira projeto de caos', () => {
    expect(chaosProjectOf(write('examples/pedidos-aspnet/Program.cs'), top)).toBeUndefined();
    expect(chaosProjectOf(write('examples/pedidos-springboot/src/Pedidos.java'), top)).toBeUndefined();
  });

  it('o package.json só de configuração de pasta não separa projeto, como no `shieldepy chaos`', () => {
    write('src/package.json', '{ "type": "module" }');
    expect(chaosProjectOf(write('src/routes.ts'), top)).toBe(top);
  });

  it('sem package.json até a pasta aberta, não há projeto', () => {
    fs.rmSync(path.join(top, 'package.json'));
    expect(chaosProjectOf(write('src/routes.ts'), top)).toBeUndefined();
  });
});

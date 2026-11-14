// O admin da plataforma nasce na primeira subida do servidor (decisão 0048): sem terminal no
// servidor, o bootstrap sai das variáveis de ambiente (ADMIN_EMAIL e ADMIN_INITIAL_PASSWORD).
import { describe, expect, it } from 'vitest';
import { bootstrapAdmin, type BootstrapCompanies } from '../src/scripts/bootstrapAdmin';

function fakeCompanies(assigned: string[] = []) {
  const calls: string[] = [];
  const companies: BootstrapCompanies = {
    getAssignment: async (email) => (assigned.includes(email.toLowerCase()) ? { companyId: 1 } : null),
    create: async (name) => {
      calls.push(`create:${name}`);
      return { id: 7, name };
    },
    setPermission: async (id, key, value) => {
      calls.push(`perm:${id}:${key}:${value}`);
    },
    assign: async (email, id, password, role) => {
      calls.push(`assign:${email}:${id}:${password ?? '-'}:${role}`);
    },
  };
  return { companies, calls };
}

describe('bootstrap do admin pelas variáveis de ambiente', () => {
  it('sem ADMIN_EMAIL, não faz nada', async () => {
    const { companies, calls } = fakeCompanies();
    expect(await bootstrapAdmin(companies, {})).toEqual({ status: 'sem-admin' });
    expect(calls).toEqual([]);
  });

  it('cria a empresa do admin, com IA liberada, e o convite com a senha inicial', async () => {
    const { companies, calls } = fakeCompanies();
    const r = await bootstrapAdmin(companies, { ADMIN_EMAIL: 'Dono@Acme.test', ADMIN_INITIAL_PASSWORD: 'senha-forte-1' });
    expect(r).toEqual({ status: 'criado', email: 'dono@acme.test', comSenha: true });
    expect(calls).toEqual(['create:ShielDepy (admin)', 'perm:7:aiEnabled:true', 'assign:dono@acme.test:7:senha-forte-1:owner']);
  });

  it('sem a senha inicial, cria o convite sem senha (entra por login social)', async () => {
    const { companies, calls } = fakeCompanies();
    expect(await bootstrapAdmin(companies, { ADMIN_EMAIL: 'dono@acme.test' })).toEqual({ status: 'criado', email: 'dono@acme.test', comSenha: false });
    expect(calls.at(-1)).toBe('assign:dono@acme.test:7:-:owner');
  });

  it('nas subidas seguintes, o admin já existe e nada muda (nem a senha)', async () => {
    const { companies, calls } = fakeCompanies(['dono@acme.test']);
    expect(await bootstrapAdmin(companies, { ADMIN_EMAIL: 'dono@acme.test', ADMIN_INITIAL_PASSWORD: 'outra-senha-1' })).toEqual({ status: 'ja-existe', email: 'dono@acme.test' });
    expect(calls).toEqual([]);
  });

  it('senha inicial curta demais não cria nada', async () => {
    const { companies, calls } = fakeCompanies();
    expect(await bootstrapAdmin(companies, { ADMIN_EMAIL: 'dono@acme.test', ADMIN_INITIAL_PASSWORD: 'curta' })).toEqual({ status: 'senha-curta' });
    expect(calls).toEqual([]);
  });

  it('e-mail sem forma de e-mail não cria nada', async () => {
    const { companies, calls } = fakeCompanies();
    expect(await bootstrapAdmin(companies, { ADMIN_EMAIL: 'dono' })).toEqual({ status: 'email-invalido' });
    expect(calls).toEqual([]);
  });
});

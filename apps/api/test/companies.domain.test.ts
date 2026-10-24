// O domínio e os casos de uso de empresas, sem banco nem HTTP (decisão 0013).
import { describe, expect, it } from 'vitest';
import { CompanyService } from '../src/domains/companies/application/companies';
import type { CompanyRepository } from '../src/domains/companies/application/ports';
import { isAcceptableInitialPassword, isValidEmail, leavesNoOwner, permissionsFrom, roleFrom, type Company, type Role } from '../src/domains/companies/domain/company';

describe('regras da empresa', () => {
  it('permissões: os padrões (acesso liberado, IA bloqueada) e o que foi gravado por cima', () => {
    expect(permissionsFrom([])).toEqual({ accessEnabled: true, aiEnabled: false });
    expect(permissionsFrom([{ key: 'accessEnabled', value: false }, { key: 'aiEnabled', value: true }])).toEqual({ accessEnabled: false, aiEnabled: true });
  });

  it('papel: só "owner" é dono', () => {
    expect(roleFrom('owner')).toBe('owner');
    expect(roleFrom('admin')).toBe('member');
    expect(roleFrom(undefined)).toBe('member');
  });

  it('a empresa nunca fica sem dono', () => {
    expect(leavesNoOwner('member', 'owner', 1)).toBe(true);
    expect(leavesNoOwner('member', 'owner', 2)).toBe(false);
    expect(leavesNoOwner('owner', 'owner', 1)).toBe(false);
    expect(leavesNoOwner('member', 'member', 1)).toBe(false);
  });

  it('convite: e-mail com forma de e-mail; senha inicial opcional, mas com 8+ caracteres', () => {
    expect(isValidEmail('ana@acme.test')).toBe(true);
    expect(isValidEmail('ana@acme')).toBe(false);
    expect(isAcceptableInitialPassword(undefined)).toBe(true);
    expect(isAcceptableInitialPassword('')).toBe(true);
    expect(isAcceptableInitialPassword('curta')).toBe(false);
    expect(isAcceptableInitialPassword('comprida1')).toBe(true);
  });
});

/** Repositório em memória com só o que estes casos usam. */
function memory() {
  const companies: Company[] = [];
  const assignments = new Map<string, { companyId: number; hash: string | null; role: Role }>();
  const users = new Set<string>();
  const perms = new Map<number, { key: string; value: boolean }[]>();
  const repo = {
    create: (name: string, now: number) => (companies.push({ id: companies.length + 1, name, createdAt: now }), companies.at(-1)!),
    list: () => companies,
    permissionRows: (id: number) => perms.get(id) ?? [],
    setPermission: (id: number, key: string, value: boolean) => perms.set(id, [...(perms.get(id) ?? []).filter((r) => r.key !== key), { key, value }]),
    assign: (email: string, companyId: number, hash: string | null, role: Role | null) => {
      const old = assignments.get(email);
      assignments.set(email, { companyId, hash: hash ?? old?.hash ?? null, role: role ?? old?.role ?? 'member' });
    },
    role: (email: string) => assignments.get(email)?.role ?? null,
    hasUser: (email: string) => users.has(email),
    removeAssignment: (email: string) => void assignments.delete(email),
    totals: () => ({ users: users.size, pendingInvites: 0, activeDevices: 0 }),
  } as unknown as CompanyRepository;
  return { service: new CompanyService(repo, () => 1), assignments, users };
}

describe('CompanyService (repositório em memória)', () => {
  it('convite: e-mail em minúsculas, senha guardada como hash, papel mantido quando não vem', async () => {
    const { service, assignments } = memory();
    await service.assign('Ana@Acme.test', 1, 'senha-inicial', 'owner');
    const stored = assignments.get('ana@acme.test')!;
    expect(stored.hash).toBeTruthy();
    expect(stored.hash).not.toContain('senha-inicial');
    await service.assign('ana@acme.test', 1);
    expect(await service.role('ANA@acme.test')).toBe('owner');
    expect(await service.role('ninguem@acme.test')).toBe('member');
  });

  it('remover convite: quem já tem conta sai pelo usuário, não pelo convite', async () => {
    const { service, users } = memory();
    await service.assign('bruno@acme.test', 1);
    users.add('bruno@acme.test');
    expect(await service.removeAssignment('Bruno@acme.test')).toEqual({ ok: false, reason: 'user_exists' });
    users.clear();
    expect(await service.removeAssignment('bruno@acme.test')).toEqual({ ok: true });
  });

  it('visão geral conta empresas suspensas e com IA', async () => {
    const { service } = memory();
    const a = await service.create('A');
    const b = await service.create('B');
    await service.create('C');
    await service.setPermission(a.id, 'accessEnabled', false);
    await service.setPermission(b.id, 'aiEnabled', true);
    expect(await service.overview()).toMatchObject({ companies: 3, suspendedCompanies: 1, aiCompanies: 1 });
    expect(await service.accessEnabled(a.id)).toBe(false);
    expect(await service.accessEnabled(b.id)).toBe(true);
  });
});

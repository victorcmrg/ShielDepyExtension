// A demonstração do pós-login no site estático (decisão 0049): empresas e funcionários de mentira, sem
// API. Os números do topo saem dos próprios dados, então nunca contradizem a lista.
import { describe, expect, it } from 'vitest';
import { connectedNow, DEMO_COMPANIES, filterCompanies, overviewOf, type DemoCompany } from '../src/portal/demo/data';

describe('dados da demonstração', () => {
  it('há empresas de exemplo, cada uma com um dono e e-mails únicos', () => {
    expect(DEMO_COMPANIES.length).toBeGreaterThanOrEqual(3);
    const emails = DEMO_COMPANIES.flatMap((c) => c.members.map((m) => m.email));
    expect(new Set(emails).size).toBe(emails.length);
    for (const c of DEMO_COMPANIES) expect(c.members.filter((m) => m.role === 'owner')).toHaveLength(1);
  });

  it('os e-mails são de domínios reservados para exemplo (nada de gente de verdade)', () => {
    for (const c of DEMO_COMPANIES) for (const m of c.members) expect(m.email).toMatch(/\.(test|example)$/);
  });

  it('o resumo conta empresas, suspensas, ativos, convites, VS Codes e IA a partir da lista', () => {
    const list: DemoCompany[] = [
      { id: 1, name: 'A', active: true, ai: true, createdDaysAgo: 3, members: [
        { name: 'Ana', email: 'ana@a.test', role: 'owner', status: 'active', devices: 2, lastSeenMinutesAgo: 1, project: 'x' },
        { name: 'Bia', email: 'bia@a.test', role: 'member', status: 'pending', devices: 0, lastSeenMinutesAgo: null, project: null },
      ] },
      { id: 2, name: 'B', active: false, ai: false, createdDaysAgo: 9, members: [
        { name: 'Caio', email: 'caio@b.test', role: 'owner', status: 'active', devices: 1, lastSeenMinutesAgo: 300, project: 'y' },
      ] },
    ];
    expect(overviewOf(list)).toEqual({ companies: 2, suspendedCompanies: 1, users: 2, pendingInvites: 1, activeDevices: 3, aiCompanies: 1 });
  });

  it('"conectados agora" são os ativos com VS Code e visto nos últimos 15 min, de empresas liberadas', () => {
    const now = connectedNow(DEMO_COMPANIES);
    expect(now.length).toBeGreaterThan(0);
    for (const p of now) {
      expect(p.member.status).toBe('active');
      expect(p.member.devices).toBeGreaterThan(0);
      expect(p.member.lastSeenMinutesAgo).toBeLessThanOrEqual(15);
      expect(p.company.active).toBe(true);
    }
    // do mais recente para o mais antigo
    for (let i = 1; i < now.length; i++) expect(now[i]!.member.lastSeenMinutesAgo!).toBeGreaterThanOrEqual(now[i - 1]!.member.lastSeenMinutesAgo!);
  });

  it('a busca acha pelo nome da empresa, pelo nome ou pelo e-mail de quem trabalha nela', () => {
    const first = DEMO_COMPANIES[0]!;
    const someone = first.members[1]!;
    expect(filterCompanies(DEMO_COMPANIES, '')).toHaveLength(DEMO_COMPANIES.length);
    expect(filterCompanies(DEMO_COMPANIES, first.name.slice(0, 4).toUpperCase()).map((c) => c.id)).toContain(first.id);
    expect(filterCompanies(DEMO_COMPANIES, someone.name).map((c) => c.id)).toContain(first.id);
    expect(filterCompanies(DEMO_COMPANIES, someone.email).map((c) => c.id)).toEqual([first.id]);
    expect(filterCompanies(DEMO_COMPANIES, 'nada-com-isso-zzz')).toEqual([]);
  });
});

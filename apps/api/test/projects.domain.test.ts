// O domínio e os casos de uso de projetos, sem banco nem HTTP (decisão 0013).
import { describe, expect, it } from 'vitest';
import type { ProjectRepository } from '../src/domains/projects/application/ports';
import { ProjectService } from '../src/domains/projects/application/projects';
import { ACTIVE_WINDOW_MS, canSee, cleanBranch, type Project } from '../src/domains/projects/domain/project';

const acme: Project = { id: 1, companyId: 10, name: 'Pedidos', description: '', createdAt: 0 };

describe('canSee: quem vê um projeto', () => {
  it('dono vê todos da empresa; membro só os de que participa; outra empresa nunca', () => {
    expect(canSee(acme, { companyId: 10, email: 'dono@acme', isOwner: true }, false)).toBe(true);
    expect(canSee(acme, { companyId: 10, email: 'ana@acme', isOwner: false }, true)).toBe(true);
    expect(canSee(acme, { companyId: 10, email: 'ana@acme', isOwner: false }, false)).toBe(false);
    expect(canSee(acme, { companyId: 99, email: 'eve@outra', isOwner: true }, true)).toBe(false);
  });

  it('o branch da extensão é limitado', () => {
    expect(cleanBranch('x'.repeat(300))).toHaveLength(120);
    expect(cleanBranch(7)).toBeNull();
  });
});

/** Repositório em memória com só o que estes casos usam. */
function memory() {
  const repos: { id: number; projectId: number; remote: string }[] = [];
  const members = new Set<string>();
  const activity: { repoId: number; email: string; branch: string | null; at: number }[] = [];
  const repo = {
    get: (id: number) => (id === acme.id ? acme : null),
    isMember: (projectId: number, email: string) => members.has(`${projectId}:${email}`),
    addMember: (projectId: number, email: string) => void members.add(`${projectId}:${email}`),
    hasRepo: (projectId: number, remote: string) => repos.some((r) => r.projectId === projectId && r.remote === remote),
    addRepo: (projectId: number, remote: string) => void repos.push({ id: repos.length + 1, projectId, remote }),
    repoIdByRemote: (projectId: number, remote: string) => repos.find((r) => r.projectId === projectId && r.remote === remote)?.id ?? null,
    findAllowedRepo: (companyId: number, remote: string, email: string, isOwner: boolean) => {
      const r = repos.find((x) => x.remote === remote && companyId === acme.companyId && (isOwner || members.has(`${x.projectId}:${email}`)));
      return r ? { repoId: r.id, projectId: r.projectId, projectName: acme.name } : null;
    },
    recordActivity: (repoId: number, email: string, branch: string | null, at: number) => void activity.push({ repoId, email, branch, at }),
    listRepos: (_projectId: number, since: number) => [since] as never,
  } as unknown as ProjectRepository;
  return { service: new ProjectService(repo, () => 5 * ACTIVE_WINDOW_MS), activity };
}

describe('ProjectService (repositório em memória)', () => {
  it('addRepo normaliza o remote e recusa o inválido e o repetido', async () => {
    const { service } = memory();
    expect(await service.addRepo(1, 'git@github.com:Acme/Checkout.git')).toEqual({ ok: true, remote: 'github.com/acme/checkout' });
    expect(await service.addRepo(1, 'https://github.com/acme/checkout')).toEqual({ ok: false, reason: 'duplicate' });
    expect(await service.addRepo(1, 'não é remote')).toEqual({ ok: false, reason: 'invalid' });
    expect(await service.repoIdByRemote(1, 'HTTPS://github.com/Acme/checkout.git')).toBe(1);
  });

  it('visibleTo: membro por e-mail, sem diferença de maiúsculas', async () => {
    const { service } = memory();
    await service.addMember(1, 'Ana@Acme.test');
    expect(await service.visibleTo(1, { companyId: 10, email: 'ana@acme.test', isOwner: false })).toEqual(acme);
    expect(await service.visibleTo(1, { companyId: 10, email: 'bruno@acme.test', isOwner: false })).toBeNull();
  });

  it('checkRepos: libera o que está num projeto da pessoa, registra o uso e ignora além de 10', async () => {
    const { service, activity } = memory();
    await service.addRepo(1, 'github.com/acme/checkout');
    await service.addMember(1, 'ana@acme.test');
    const ana = { companyId: 10, email: 'Ana@acme.test', isOwner: false };
    const result = await service.checkRepos(ana, [
      { remote: 'git@github.com:acme/checkout.git', branch: 'main' },
      { remote: 'github.com/acme/outro' },
      { remote: 'lixo' },
    ]);
    expect(result).toEqual([
      { remote: 'github.com/acme/checkout', allowed: true, project: { id: 1, name: 'Pedidos' } },
      { remote: 'github.com/acme/outro', allowed: false, project: null },
      { remote: 'lixo', allowed: false, project: null },
    ]);
    expect(activity).toEqual([{ repoId: 1, email: 'ana@acme.test', branch: 'main', at: 5 * ACTIVE_WINDOW_MS }]);
    expect(await service.checkRepos(ana, Array.from({ length: 15 }, () => ({ remote: 'lixo' })))).toHaveLength(10);
  });

  it('a janela de "em uso" é das últimas 24 h', async () => {
    expect(await memory().service.listRepos(1)).toEqual([4 * ACTIVE_WINDOW_MS]);
  });
});

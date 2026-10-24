// O domínio e os casos de uso de identidade, sem banco nem HTTP (decisão 0013).
import { describe, expect, it } from 'vitest';
import { hashPassword } from '../src/shared/crypto/passwords';
import { IdentityService, type IdentityRepositories } from '../src/domains/identity/application/identity';
import { deviceLabel, isUsable } from '../src/domains/identity/domain/credentials';
import { canConfirm, canExchange, currentStatus, type CeremonyStatus } from '../src/domains/identity/domain/deviceAuth';
import { canConsumeState, deviceStateFrom, pickVerifiedEmail } from '../src/domains/identity/domain/oauth';
import { isPlatformAdmin, type User } from '../src/domains/identity/domain/user';

describe('regras de identidade', () => {
  it('credencial vale se não foi revogada e não venceu', () => {
    expect(isUsable({ expiresAt: 10 }, 10)).toBe(true);
    expect(isUsable({ expiresAt: 9 }, 10)).toBe(false);
    expect(isUsable({ expiresAt: 99, revokedAt: 5 }, 10)).toBe(false);
    expect(deviceLabel('')).toBeNull();
    expect(deviceLabel('x'.repeat(200))).toHaveLength(120);
  });

  it('cerimônia: pendente vencida expira; confirma só pendente no prazo; troca só confirmada, com usuário e código no prazo', () => {
    expect(currentStatus({ status: 'pending', expiresAt: 5 }, 10)).toBe('expired');
    expect(currentStatus({ status: 'confirmed', expiresAt: 5 }, 10)).toBe('confirmed');
    expect(canConfirm({ status: 'pending', expiresAt: 10 }, 10)).toBe(true);
    expect(canConfirm({ status: 'confirmed', expiresAt: 99 }, 10)).toBe(false);
    expect(canExchange({ status: 'confirmed', userId: 1, codeExpiresAt: 10 }, 10)).toBe(true);
    expect(canExchange({ status: 'confirmed', userId: 1, codeExpiresAt: null }, 10)).toBe(false);
    expect(canExchange({ status: 'exchanged', userId: 1, codeExpiresAt: 99 }, 10)).toBe(false);
  });

  it('OAuth: state de uso único e do mesmo provedor; e-mail verificado do GitHub; contexto da extensão', () => {
    expect(canConsumeState({ provider: 'github', consumedAt: null, expiresAt: 10 }, 'github', 10)).toBe(true);
    expect(canConsumeState({ provider: 'google', consumedAt: null, expiresAt: 10 }, 'github', 10)).toBe(false);
    expect(canConsumeState({ provider: 'github', consumedAt: 3, expiresAt: 10 }, 'github', 1)).toBe(false);
    expect(pickVerifiedEmail([{ email: 'a', primary: true, verified: false }, { email: 'b', primary: false, verified: true }])).toBe('b');
    expect(pickVerifiedEmail([{ email: 'a', primary: false, verified: false }])).toBeNull();
    expect(deviceStateFrom('{"deviceState":"abc"}')).toBe('abc');
    expect(deviceStateFrom('{quebrado')).toBeUndefined();
    expect(deviceStateFrom(null)).toBeUndefined();
  });

  it('admin da plataforma é o ADMIN_EMAIL, sem diferença de maiúsculas; sem ADMIN_EMAIL, ninguém', () => {
    expect(isPlatformAdmin('Dono@Acme.test', 'dono@acme.test')).toBe(true);
    expect(isPlatformAdmin('dono@acme.test', undefined)).toBe(false);
  });
});

/** Repositórios em memória com só o que estes casos usam. */
function memory(clock = { t: 1000 }) {
  const users: User[] = [];
  const ceremonies = new Map<string, { status: CeremonyStatus; expiresAt: number; userId: number | null; codeHash: string | null; codeExpiresAt: number | null }>();
  const devices = new Map<string, { userId: number; expiresAt: number; revokedAt: number | null }>();
  const repos = {
    users: {
      byEmail: (e: string) => users.find((u) => u.email === e) ?? null,
      byId: (id: number) => users.find((u) => u.id === id) ?? null,
      create: (email: string, companyId: number, passwordHash: string | null) => (users.push({ id: users.length + 1, email, companyId, passwordHash }), users.at(-1)!),
      touchLastLogin: () => {},
      setPasswordHash: (id: number, hash: string) => void (users.find((u) => u.id === id)!.passwordHash = hash),
    },
    ceremonies: {
      find: (state: string) => ceremonies.get(state) ?? null,
      create: (state: string, _now: number, expiresAt: number) => void ceremonies.set(state, { status: 'pending', expiresAt, userId: null, codeHash: null, codeExpiresAt: null }),
      markExpired: (state: string) => void (ceremonies.get(state)!.status = 'expired'),
      confirm: (state: string, userId: number, codeHash: string, codeExpiresAt: number) => void Object.assign(ceremonies.get(state)!, { status: 'confirmed', userId, codeHash, codeExpiresAt }),
      findByCode: (hash: string) => {
        const [state, c] = [...ceremonies].find(([, c]) => c.codeHash === hash) ?? [];
        return state && c ? { state, status: c.status, userId: c.userId, codeExpiresAt: c.codeExpiresAt } : null;
      },
      markExchanged: (state: string) => void (ceremonies.get(state)!.status = 'exchanged'),
    },
    devices: {
      create: (hash: string, userId: number, _now: number, expiresAt: number) => void devices.set(hash, { userId, expiresAt, revokedAt: null }),
      find: (hash: string) => {
        const d = devices.get(hash);
        return d ? { user: { id: d.userId, email: 'x', companyId: 1 }, expiresAt: d.expiresAt, revokedAt: d.revokedAt } : null;
      },
      slide: (hash: string, _now: number, expiresAt: number) => void (devices.get(hash)!.expiresAt = expiresAt),
      revokeByHash: (hash: string, now: number) => void (devices.get(hash)!.revokedAt = now),
    },
  } as unknown as IdentityRepositories;
  const invitations = new Map<string, { companyId: number; initialPasswordHash: string | null }>();
  const service = new IdentityService(repos, {} as never, { getAssignment: (e) => invitations.get(e) ?? null }, () => clock.t);
  return { service, clock, invitations, users };
}

describe('IdentityService (repositórios em memória)', () => {
  it('login por senha: sem convite 403; convite sem senha 401; senha errada 401; primeiro login cria a conta', () => {
    const { service, invitations, users } = memory();
    expect(service.loginWithPassword('ana@acme.test', 'x')).toMatchObject({ ok: false, status: 403 });
    invitations.set('ana@acme.test', { companyId: 1, initialPasswordHash: null });
    expect(service.loginWithPassword('ana@acme.test', 'x')).toMatchObject({ ok: false, status: 401 });
    invitations.set('ana@acme.test', { companyId: 1, initialPasswordHash: hashPassword('Senha-Inicial-1') });
    expect(service.loginWithPassword('ana@acme.test', 'errada')).toMatchObject({ ok: false, status: 401, error: 'credenciais inválidas' });
    const ok = service.loginWithPassword(' Ana@Acme.test ', 'Senha-Inicial-1');
    expect(ok).toMatchObject({ ok: true, user: { email: 'ana@acme.test', companyId: 1 } });
    expect(users).toHaveLength(1);
  });

  it('troca de senha: mínimo de 8; com senha, exige a atual', () => {
    const { service, invitations } = memory();
    invitations.set('ana@acme.test', { companyId: 1, initialPasswordHash: hashPassword('Senha-Inicial-1') });
    const { user } = service.loginWithPassword('ana@acme.test', 'Senha-Inicial-1') as { user: User };
    expect(service.changePassword(user.id, 'Senha-Inicial-1', 'curta')).toMatchObject({ ok: false, status: 400 });
    expect(service.changePassword(user.id, 'errada', 'Nova-Senha-22')).toMatchObject({ ok: false, status: 401 });
    expect(service.changePassword(user.id, 'Senha-Inicial-1', 'Nova-Senha-22')).toEqual({ ok: true });
    expect(service.loginWithPassword('ana@acme.test', 'Nova-Senha-22').ok).toBe(true);
  });

  it('cerimônia ponta a ponta: pendente → confirmada → código vira token uma vez; o token vale até ser revogado', () => {
    const { service, clock } = memory();
    expect(service.ceremonyStatus('s1')).toBe('pending');
    const code = service.confirmCeremony('s1', 7)!;
    expect(code).toBeTruthy();
    expect(service.confirmCeremony('s1', 7)).toBeNull();
    const token = service.exchangeCode(code, 'VS Code do Ana')!;
    expect(token.startsWith('sde_')).toBe(true);
    expect(service.exchangeCode(code)).toBeNull();
    expect(service.deviceUser(token)).toMatchObject({ id: 7 });
    service.revokeDeviceToken(token);
    expect(service.deviceUser(token)).toBeNull();
    // cerimônia esquecida: depois de 5 minutos, expira
    service.ceremonyStatus('s2');
    clock.t += 6 * 60 * 1000;
    expect(service.ceremonyStatus('s2')).toBe('expired');
    expect(service.confirmCeremony('s2', 7)).toBeNull();
  });
});

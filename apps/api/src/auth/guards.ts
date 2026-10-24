// Checagens que as rotas de vários contextos usam: quem está logado, se é dono, se o projeto é
// visível para a pessoa, e a leitura do corpo. Vão para identity/projects nas fatias S7c–S7e.
import type { IncomingMessage } from 'node:http';
import { HttpError, readBody } from '../shared/http/http';
import { projects } from '../composition';
import type { Project } from '../domains/projects/domain/project';
import { getRole } from './companies';
import { requireSession } from './middleware';
import type { AuthUser } from './session';

export async function json<T>(req: IncomingMessage): Promise<T> {
  try {
    return JSON.parse(await readBody(req)) as T;
  } catch {
    throw new HttpError(400, 'corpo da requisição inválido');
  }
}

export function user(req: IncomingMessage): AuthUser {
  const u = requireSession(req);
  if (!u) throw new HttpError(401, 'não autenticado');
  return u;
}

export function owner(req: IncomingMessage): AuthUser {
  const u = user(req);
  if (getRole(u.email) !== 'owner') throw new HttpError(403, 'só o dono da empresa pode fazer isso');
  return u;
}

/** Projeto da empresa do usuário — e, pra quem não é dono, só se participar dele. */
export function projectFor(u: AuthUser, id: number): Project {
  const p = projects.visibleTo(id, { companyId: u.companyId, email: u.email, isOwner: getRole(u.email) === 'owner' });
  if (!p) throw new HttpError(404, 'projeto não encontrado');
  return p;
}

export function cleanText(raw: unknown, max: number, field: string, required: boolean): string {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (required && !value) throw new HttpError(400, `preencha ${field}`);
  if (value.length > max) throw new HttpError(400, `${field} longo demais (máx. ${max})`);
  return value;
}

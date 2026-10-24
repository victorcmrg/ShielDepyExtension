// O contrato de "quem pode chamar esta rota", sem tipo de domínio nenhum: o domínio identity
// implementa (identity/http/access.ts) e o composition.ts entrega às rotas de todos os domínios.
import type { IncomingMessage } from 'node:http';

/** Quem está fazendo a requisição (sessão web ou token da extensão). */
export interface RequestUser {
  id: number;
  email: string;
  companyId: number;
}

export interface Access {
  /** O usuário da sessão web, ou null. */
  session(req: IncomingMessage): RequestUser | null;
  /** O usuário do token da extensão (Authorization: Bearer), ou null. */
  device(req: IncomingMessage): RequestUser | null;
  isAdmin(user: { email: string } | null): boolean;
  /** Sessão obrigatória (401). */
  user(req: IncomingMessage): RequestUser;
  /** Dono da empresa (403). */
  owner(req: IncomingMessage): RequestUser;
  /** Admin da plataforma (403). */
  admin(req: IncomingMessage): RequestUser;
}

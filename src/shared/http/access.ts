// O contrato de "quem pode chamar esta rota", sem tipo de domínio nenhum: o domínio identity
// implementa (identity/http/access.ts) e o composition.ts entrega às rotas de todos os domínios.
// Assíncrono: a sessão e o token estão no banco.
import type { IncomingMessage } from 'node:http';

/** Quem está fazendo a requisição (sessão web ou token da extensão). */
export interface RequestUser {
  id: number;
  email: string;
  companyId: number;
}

export interface Access {
  /** O usuário da sessão web, ou null. */
  session(req: IncomingMessage): Promise<RequestUser | null>;
  /** O usuário do token da extensão (Authorization: Bearer), ou null. */
  device(req: IncomingMessage): Promise<RequestUser | null>;
  isAdmin(user: { email: string } | null): boolean;
  /** Sessão obrigatória (401). */
  user(req: IncomingMessage): Promise<RequestUser>;
  /** Dono da empresa (403). */
  owner(req: IncomingMessage): Promise<RequestUser>;
  /** Admin da plataforma (403). */
  admin(req: IncomingMessage): Promise<RequestUser>;
}

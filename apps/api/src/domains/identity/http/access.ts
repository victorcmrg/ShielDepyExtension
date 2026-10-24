// A implementação do Access (shared/http/access.ts): sessão web, token da extensão, dono da
// empresa e admin da plataforma.
import type { Access } from '../../../shared/http/access';
import { HttpError } from '../../../shared/http/http';
import type { CompanyService } from '../../companies/application/companies';
import type { IdentityService } from '../application/identity';
import { isPlatformAdmin } from '../domain/user';
import { SESSION_COOKIE, parseCookies } from './cookies';

export function accessGuards(identity: IdentityService, companies: CompanyService): Access {
  const access: Access = {
    async session(req) {
      const raw = parseCookies(req)[SESSION_COOKIE];
      return raw ? identity.sessionUser(raw) : null;
    },
    async device(req) {
      const header = req.headers.authorization;
      if (!header || !header.startsWith('Bearer ')) return null;
      return identity.deviceUser(header.slice('Bearer '.length).trim());
    },
    isAdmin: (user) => (user ? isPlatformAdmin(user.email, process.env.ADMIN_EMAIL) : false),
    async user(req) {
      const u = await access.session(req);
      if (!u) throw new HttpError(401, 'não autenticado');
      return u;
    },
    async owner(req) {
      const u = await access.user(req);
      if ((await companies.role(u.email)) !== 'owner') throw new HttpError(403, 'só o dono da empresa pode fazer isso');
      return u;
    },
    async admin(req) {
      const u = await access.user(req);
      if (!access.isAdmin(u)) throw new HttpError(403, 'acesso restrito ao admin');
      return u;
    },
  };
  return access;
}

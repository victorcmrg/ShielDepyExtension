// Montagem da API (composition root): cria os repositórios sobre o banco, os serviços de cada
// domínio, as checagens de acesso e as rotas. É o único lugar que junta domínios; o app.ts, os
// testes e os scripts usam daqui.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ChaosRunService } from './domains/chaos-runs/application/chaosRuns';
import { chaosRunRoutes } from './domains/chaos-runs/http/routes';
import { SqliteChaosRunRepository } from './domains/chaos-runs/infra/SqliteChaosRunRepository';
import { SqliteCiTokenRepository } from './domains/chaos-runs/infra/SqliteCiTokenRepository';
import { CompanyService } from './domains/companies/application/companies';
import { companyAdminRoutes } from './domains/companies/http/adminRoutes';
import { teamRoutes } from './domains/companies/http/teamRoutes';
import { SqliteCompanyRepository } from './domains/companies/infra/SqliteCompanyRepository';
import { IdentityService } from './domains/identity/application/identity';
import { accessGuards } from './domains/identity/http/access';
import { identityRoutes } from './domains/identity/http/routes';
import { HttpOAuthClient } from './domains/identity/infra/HttpOAuthClient';
import {
  SqliteDeviceAuthRepository,
  SqliteDeviceTokenRepository,
  SqliteOAuthStateRepository,
  SqliteSessionRepository,
  SqliteUserRepository,
} from './domains/identity/infra/SqliteIdentityRepositories';
import { ProjectService } from './domains/projects/application/projects';
import { projectRoutes } from './domains/projects/http/routes';
import { SqliteProjectRepository } from './domains/projects/infra/SqliteProjectRepository';
import { db } from './shared/db/sqlite';
import { dispatch, type Route } from './shared/http/http';

export const companies = new CompanyService(new SqliteCompanyRepository(db));
export const projects = new ProjectService(new SqliteProjectRepository(db));
export const chaosRuns = new ChaosRunService(new SqliteChaosRunRepository(db), new SqliteCiTokenRepository(db), projects);
export const identity = new IdentityService(
  {
    users: new SqliteUserRepository(db),
    sessions: new SqliteSessionRepository(db),
    devices: new SqliteDeviceTokenRepository(db),
    ceremonies: new SqliteDeviceAuthRepository(db),
    oauthStates: new SqliteOAuthStateRepository(db),
  },
  new HttpOAuthClient(),
  companies
);
const access = accessGuards(identity, companies);

export const ROUTES: Route[] = [
  ...identityRoutes(identity, companies, access),
  ...companyAdminRoutes(companies, identity, access),
  ...teamRoutes(companies, projects, identity, access),
  ...projectRoutes(projects, companies, access),
  ...chaosRunRoutes(chaosRuns, projects, companies, access),
];

/** Trata uma /api/*; `false` se nenhuma rota casou. */
export function handleApiRoute(req: IncomingMessage, res: ServerResponse, pathname: string, url: URL): Promise<boolean> {
  return dispatch(ROUTES, req, res, pathname, url);
}

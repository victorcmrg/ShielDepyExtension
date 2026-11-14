// Montagem da API (composition root): abre o banco (aplicando as migrations pendentes), cria os
// repositórios, os serviços de cada domínio, as checagens de acesso e as rotas. É o único lugar
// que junta domínios; o app.ts, os testes e os scripts usam daqui (e fecham o `database` no fim).
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ChaosRunService } from './domains/chaos-runs/application/chaosRuns';
import { chaosRunRoutes } from './domains/chaos-runs/http/routes';
import { DrizzleChaosRunRepository } from './domains/chaos-runs/infra/DrizzleChaosRunRepository';
import { DrizzleCiTokenRepository } from './domains/chaos-runs/infra/DrizzleCiTokenRepository';
import { CompanyService } from './domains/companies/application/companies';
import { companyAdminRoutes } from './domains/companies/http/adminRoutes';
import { teamRoutes } from './domains/companies/http/teamRoutes';
import { DrizzleCompanyRepository } from './domains/companies/infra/DrizzleCompanyRepository';
import { IdentityService } from './domains/identity/application/identity';
import { accessGuards } from './domains/identity/http/access';
import { identityRoutes } from './domains/identity/http/routes';
import { HttpOAuthClient } from './domains/identity/infra/HttpOAuthClient';
import {
  DrizzleDeviceAuthRepository,
  DrizzleDeviceTokenRepository,
  DrizzleOAuthStateRepository,
  DrizzleSessionRepository,
  DrizzleUserRepository,
} from './domains/identity/infra/DrizzleIdentityRepositories';
import { ProjectService } from './domains/projects/application/projects';
import { projectRoutes } from './domains/projects/http/routes';
import { DrizzleProjectRepository } from './domains/projects/infra/DrizzleProjectRepository';
import { openDatabase } from './shared/db/postgres';
import { dispatch, type Route } from './shared/http/http';

/** Postgres com DATABASE_URL; senão o PGlite em SHIELDEPY_DATA_DIR/pglite (shared/db/postgres.ts). */
export const database = await openDatabase();
const { db } = database;

export const companies = new CompanyService(new DrizzleCompanyRepository(db));
export const projects = new ProjectService(new DrizzleProjectRepository(db));
export const chaosRuns = new ChaosRunService(new DrizzleChaosRunRepository(db), new DrizzleCiTokenRepository(db), projects);
export const identity = new IdentityService(
  {
    users: new DrizzleUserRepository(db),
    sessions: new DrizzleSessionRepository(db),
    devices: new DrizzleDeviceTokenRepository(db),
    ceremonies: new DrizzleDeviceAuthRepository(db),
    oauthStates: new DrizzleOAuthStateRepository(db),
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

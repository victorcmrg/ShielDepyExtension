// Montagem da API (composition root): cria os repositórios sobre o banco, os serviços de cada
// domínio e as rotas. É o único lugar que junta domínios; o app.ts, os testes e a demo usam daqui.
import { ChaosRunService } from './domains/chaos-runs/application/chaosRuns';
import { chaosRunRoutes } from './domains/chaos-runs/http/routes';
import { SqliteChaosRunRepository } from './domains/chaos-runs/infra/SqliteChaosRunRepository';
import { SqliteCiTokenRepository } from './domains/chaos-runs/infra/SqliteCiTokenRepository';
import { CompanyService } from './domains/companies/application/companies';
import { companyAdminRoutes } from './domains/companies/http/adminRoutes';
import { teamRoutes } from './domains/companies/http/teamRoutes';
import { SqliteCompanyRepository } from './domains/companies/infra/SqliteCompanyRepository';
import { ProjectService } from './domains/projects/application/projects';
import { projectRoutes } from './domains/projects/http/routes';
import { SqliteProjectRepository } from './domains/projects/infra/SqliteProjectRepository';
import { db } from './shared/db/sqlite';
import type { Route } from './shared/http/http';

export const companies = new CompanyService(new SqliteCompanyRepository(db));
export const projects = new ProjectService(new SqliteProjectRepository(db));
export const chaosRuns = new ChaosRunService(new SqliteChaosRunRepository(db), new SqliteCiTokenRepository(db), projects);

/** As rotas dos domínios (as de auth/routes.ts ainda vêm à parte, até a S7e). */
export const DOMAIN_ROUTES: Route[] = [
  ...companyAdminRoutes(companies),
  ...teamRoutes(companies, projects),
  ...projectRoutes(projects, companies),
  ...chaosRunRoutes(chaosRuns, projects, companies),
];

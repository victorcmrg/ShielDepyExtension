// Montagem do contexto de execuções do caos: os repositórios SQLite, o serviço e as rotas. É a
// entrada para o app.ts, os testes e a demo; outro domínio usa só a application (decisão 0013).
import { repoIdByRemote } from '../../auth/projects';
import { db } from '../../shared/db/sqlite';
import { ChaosRunService } from './application/chaosRuns';
import { chaosRunRoutes } from './http/routes';
import { SqliteChaosRunRepository } from './infra/SqliteChaosRunRepository';
import { SqliteCiTokenRepository } from './infra/SqliteCiTokenRepository';

export const chaosRuns = new ChaosRunService(new SqliteChaosRunRepository(db), new SqliteCiTokenRepository(db), { repoIdByRemote });
export const CHAOS_RUN_ROUTES = chaosRunRoutes(chaosRuns);

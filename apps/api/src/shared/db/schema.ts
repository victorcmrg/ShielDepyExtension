// O esquema do banco da API (Postgres), num arquivo só: há chaves estrangeiras entre domínios e o
// histórico de migrations é um só (decisões 0013 e 0015). Cada seção é de um domínio, e só a infra
// dele usa as tabelas da seção. Mudou algo aqui: `npm run db:generate -w @shieldepy/api` gera a
// migration em apps/api/drizzle/, que vai junto no commit.
//
// Datas são milissegundos desde 1970 (bigint em modo number), como o Date.now() do código. E-mails
// são guardados em minúsculas pelo código (o SQLite usava COLLATE NOCASE).
import { sql } from 'drizzle-orm';
import { bigint, boolean, check, doublePrecision, index, integer, jsonb, pgTable, primaryKey, text, unique } from 'drizzle-orm/pg-core';

const id = () => integer('id').primaryKey().generatedAlwaysAsIdentity();
const millis = (name: string) => bigint(name, { mode: 'number' });

// --- companies --------------------------------------------------------------------------------

export const companies = pgTable('companies', {
  id: id(),
  name: text('name').notNull(),
  createdAt: millis('created_at').notNull(),
});

export const companyPermissions = pgTable(
  'company_permissions',
  {
    companyId: integer('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    value: boolean('value').notNull(),
  },
  (t) => [primaryKey({ columns: [t.companyId, t.key] })]
);

/** A allow-list: o e-mail convidado, a empresa, o papel e a senha inicial (hash). */
export const emailCompanyAssignments = pgTable(
  'email_company_assignments',
  {
    id: id(),
    email: text('email').notNull().unique(),
    companyId: integer('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    initialPasswordHash: text('initial_password_hash'),
    role: text('role').notNull().default('member'),
    createdAt: millis('created_at').notNull(),
  },
  (t) => [check('email_company_assignments_role', sql`${t.role} in ('owner', 'member')`)]
);

// --- identity ---------------------------------------------------------------------------------

export const users = pgTable('users', {
  id: id(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash'),
  companyId: integer('company_id')
    .notNull()
    .references(() => companies.id),
  createdAt: millis('created_at').notNull(),
  lastLoginAt: millis('last_login_at'),
});

export const oauthIdentities = pgTable(
  'oauth_identities',
  {
    id: id(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    providerUserId: text('provider_user_id').notNull(),
    email: text('email').notNull(),
    createdAt: millis('created_at').notNull(),
  },
  (t) => [unique('oauth_identities_provider_user').on(t.provider, t.providerUserId), check('oauth_identities_provider', sql`${t.provider} in ('google', 'github')`)]
);

export const sessions = pgTable('sessions', {
  id: id(),
  tokenHash: text('token_hash').notNull().unique(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: millis('created_at').notNull(),
  expiresAt: millis('expires_at').notNull(),
  lastSeenAt: millis('last_seen_at').notNull(),
});

export const deviceTokens = pgTable('device_tokens', {
  id: id(),
  tokenHash: text('token_hash').notNull().unique(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  label: text('label'),
  createdAt: millis('created_at').notNull(),
  expiresAt: millis('expires_at').notNull(),
  revokedAt: millis('revoked_at'),
  lastUsedAt: millis('last_used_at'),
});

export const oauthStates = pgTable(
  'oauth_states',
  {
    id: id(),
    state: text('state').notNull().unique(),
    provider: text('provider').notNull(),
    redirectContext: text('redirect_context'),
    createdAt: millis('created_at').notNull(),
    expiresAt: millis('expires_at').notNull(),
    consumedAt: millis('consumed_at'),
  },
  (t) => [check('oauth_states_provider', sql`${t.provider} in ('google', 'github')`)]
);

/** A cerimônia de "confiar" a extensão (device flow). */
export const deviceAuthRequests = pgTable(
  'device_auth_requests',
  {
    id: id(),
    state: text('state').notNull().unique(),
    status: text('status').notNull().default('pending'),
    // sem cascata, como antes: quem apaga usuário limpa estas linhas primeiro
    userId: integer('user_id').references(() => users.id),
    exchangeCodeHash: text('exchange_code_hash'),
    exchangeCodeExpiresAt: millis('exchange_code_expires_at'),
    createdAt: millis('created_at').notNull(),
    expiresAt: millis('expires_at').notNull(),
    confirmedAt: millis('confirmed_at'),
    exchangedAt: millis('exchanged_at'),
  },
  (t) => [check('device_auth_requests_status', sql`${t.status} in ('pending', 'confirmed', 'exchanged', 'expired')`)]
);

// --- projects ---------------------------------------------------------------------------------

export const projects = pgTable('projects', {
  id: id(),
  companyId: integer('company_id')
    .notNull()
    .references(() => companies.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  createdAt: millis('created_at').notNull(),
});

export const projectRepos = pgTable(
  'project_repos',
  {
    id: id(),
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    remote: text('remote').notNull(),
    createdAt: millis('created_at').notNull(),
  },
  (t) => [unique('project_repos_project_remote').on(t.projectId, t.remote)]
);

export const projectMembers = pgTable(
  'project_members',
  {
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    addedAt: millis('added_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.email] })]
);

/** Última vez que a extensão de alguém abriu o repositório (vem do .git do workspace). */
export const repoActivity = pgTable(
  'repo_activity',
  {
    repoId: integer('repo_id')
      .notNull()
      .references(() => projectRepos.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    branch: text('branch'),
    lastSeenAt: millis('last_seen_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.repoId, t.email] })]
);

// --- chaos-runs -------------------------------------------------------------------------------

export const projectCiTokens = pgTable('project_ci_tokens', {
  id: id(),
  projectId: integer('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  label: text('label').notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: millis('created_at').notNull(),
  lastUsedAt: millis('last_used_at'),
  revokedAt: millis('revoked_at'),
});

export const chaosRuns = pgTable(
  'chaos_runs',
  {
    id: id(),
    repoId: integer('repo_id')
      .notNull()
      .references(() => projectRepos.id, { onDelete: 'cascade' }),
    createdAt: millis('created_at').notNull(),
    commitSha: text('commit_sha').notNull(),
    branch: text('branch'),
    pr: integer('pr'),
    prUrl: text('pr_url'),
    runUrl: text('run_url'),
    status: text('status').notNull(),
    hits: integer('hits').notNull(),
    failed: integer('failed').notNull(),
    passed: integer('passed').notNull(),
    invalid: integer('invalid').notNull(),
    untested: integer('untested').notNull(),
    failOn: text('fail_on').notNull(),
    engine: text('engine').notNull(),
    costUsd: doublePrecision('cost_usd').notNull(),
    payload: jsonb('payload').notNull(),
  },
  (t) => [index('chaos_runs_repo').on(t.repoId, t.createdAt.desc())]
);

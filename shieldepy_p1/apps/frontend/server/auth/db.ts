// Banco SQLite nativo (node:sqlite) do sistema de autenticação multi-tenant.
// Um único arquivo, sem ORM — os módulos em apps/frontend/server/auth/*.ts fazem as queries diretamente.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const DATA_DIR = fileURLToPath(new URL('../../data', import.meta.url));
mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(join(DATA_DIR, 'auth.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS companies (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS company_permissions (
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    key        TEXT NOT NULL,
    value      TEXT NOT NULL,
    PRIMARY KEY (company_id, key)
  );

  CREATE TABLE IF NOT EXISTS email_company_assignments (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    email                TEXT NOT NULL UNIQUE COLLATE NOCASE,
    company_id           INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    initial_password_hash TEXT,
    created_at           INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    email           TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash   TEXT,
    company_id      INTEGER NOT NULL REFERENCES companies(id),
    created_at      INTEGER NOT NULL,
    last_login_at   INTEGER
  );

  CREATE TABLE IF NOT EXISTS oauth_identities (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider          TEXT NOT NULL CHECK (provider IN ('google','github')),
    provider_user_id  TEXT NOT NULL,
    email             TEXT NOT NULL,
    created_at        INTEGER NOT NULL,
    UNIQUE (provider, provider_user_id)
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash    TEXT NOT NULL UNIQUE,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at    INTEGER NOT NULL,
    expires_at    INTEGER NOT NULL,
    last_seen_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS device_tokens (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash     TEXT NOT NULL UNIQUE,
    user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at     INTEGER NOT NULL,
    expires_at     INTEGER NOT NULL,
    revoked_at     INTEGER,
    last_used_at   INTEGER
  );

  CREATE TABLE IF NOT EXISTS oauth_states (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    state            TEXT NOT NULL UNIQUE,
    provider         TEXT NOT NULL CHECK (provider IN ('google','github')),
    redirect_context TEXT,
    created_at       INTEGER NOT NULL,
    expires_at       INTEGER NOT NULL,
    consumed_at      INTEGER
  );

  CREATE TABLE IF NOT EXISTS device_auth_requests (
    id                        INTEGER PRIMARY KEY AUTOINCREMENT,
    state                     TEXT NOT NULL UNIQUE,
    status                    TEXT NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending','confirmed','exchanged','expired')),
    user_id                   INTEGER REFERENCES users(id),
    exchange_code_hash        TEXT,
    exchange_code_expires_at  INTEGER,
    created_at                INTEGER NOT NULL,
    expires_at                INTEGER NOT NULL,
    confirmed_at              INTEGER,
    exchanged_at              INTEGER
  );
`);

// Migrações leves pra bases criadas antes da coluna existir (SQLite não tem ADD COLUMN IF NOT EXISTS).
for (const sql of [
  'ALTER TABLE device_tokens ADD COLUMN label TEXT',
  // Papel na empresa: 'owner' monta projetos/repositórios/equipe; 'member' usa o que recebeu.
  "ALTER TABLE email_company_assignments ADD COLUMN role TEXT NOT NULL DEFAULT 'member'",
]) {
  try {
    db.exec(sql);
  } catch {
    // coluna já existe
  }
}

// Projetos da empresa: cada um agrupa repositórios (pelo remote do .git) e as pessoas que podem
// usar a ferramenta neles. Membros vêm por e-mail — funciona antes mesmo do primeiro login.
db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS project_repos (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    remote     TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE (project_id, remote)
  );

  CREATE TABLE IF NOT EXISTS project_members (
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    email      TEXT NOT NULL COLLATE NOCASE,
    added_at   INTEGER NOT NULL,
    PRIMARY KEY (project_id, email)
  );

  -- Última vez que a extensão de alguém abriu o repositório (vem do .git do workspace).
  CREATE TABLE IF NOT EXISTS repo_activity (
    repo_id      INTEGER NOT NULL REFERENCES project_repos(id) ON DELETE CASCADE,
    email        TEXT NOT NULL COLLATE NOCASE,
    branch       TEXT,
    last_seen_at INTEGER NOT NULL,
    PRIMARY KEY (repo_id, email)
  );
`);

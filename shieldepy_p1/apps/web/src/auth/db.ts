// Banco SQLite nativo (node:sqlite) do sistema de autenticação multi-tenant.
// Um único arquivo, sem ORM — os módulos em apps/web/src/auth/*.ts fazem as queries diretamente.
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

// Migração leve pra bases criadas antes da coluna existir (SQLite não tem ADD COLUMN IF NOT EXISTS).
try {
  db.exec('ALTER TABLE device_tokens ADD COLUMN label TEXT');
} catch {
  // coluna já existe
}

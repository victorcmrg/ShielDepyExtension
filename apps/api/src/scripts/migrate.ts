// Aplica as migrations pendentes e sai (decisão 0015). É o passo do deploy antes de subir a API:
// a API também aplica ao subir, mas assim a migração fica visível e separada.
//   npm run db:migrate -w @shieldepy/api
// Com DATABASE_URL, no Postgres dela; sem, no PGlite em SHIELDEPY_DATA_DIR/pglite (padrão apps/api/data).
// Não importa a composition: só o banco.
import { openDatabase } from '../shared/db/postgres';

const database = await openDatabase();
try {
  const where = database.kind === 'postgres' ? 'Postgres (DATABASE_URL)' : 'PGlite local';
  console.log(
    database.migrationsApplied === 0
      ? `${where}: nenhuma migration pendente.`
      : `${where}: ${database.migrationsApplied} migration(s) aplicada(s).`,
  );
} finally {
  // o PGlite só grava no disco ao fechar
  await database.close();
}

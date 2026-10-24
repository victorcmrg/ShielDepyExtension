// Recria a empresa de demonstração (demoData.ts) no banco local.
//   npm run seed:demo -w @shieldepy/api
import { database } from '../composition';
import { seedDemo } from './demoData';

try {
  await seedDemo();
} finally {
  // o PGlite só grava no disco ao fechar
  await database.close();
}

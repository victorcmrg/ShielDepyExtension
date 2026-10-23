// Tradutores de sistemas reais para Rule[]. Importam do core; o core nunca importa daqui.
// A conexão com Postgres fica em `@shieldepy/extractors/postgres-connect` (carrega `pg`).
export * from './types';
export * from './translate';
export * from './registry';
export * from './scan';
export * from './sources';

export { extractEventHandlers, parseTsHandlers } from './treesitter/event-handlers';
export { parseJava, extractJavaListeners } from './treesitter/java-spring';
export { parsePython, extractDjangoReceivers } from './treesitter/python-django';
export { parseCSharp, extractMediatrHandlers } from './treesitter/dotnet-mediatr';
export { extractFieldAccess as extractPgFieldAccess, type FieldAccessResult } from './postgres/extract';
export { tokenizeSql as tokenizePlpgsql, type SqlToken as PlpgsqlToken } from '@shieldepy/core';
export { translateTriggers, type PgTriggerRow } from './postgres/translate';
export { deriveResource, prefixResource } from './naming';

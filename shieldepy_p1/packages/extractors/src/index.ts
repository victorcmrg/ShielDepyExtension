// Tradutores de sistemas reais para Rule[]. Importam do core; o core nunca importa daqui.
// A conexão com Postgres fica em `@shieldepy/extractors/postgres-connect` (carrega `pg`).
export * from './types';
export * from './translate';
export * from './registry';
export * from './scan';
export * from './sources';

export { extractEventHandlers, parseTsHandlers } from './treesitter/event-handlers';
export { parseNodeHandlers } from './regex/node-events';
export { parseJava } from './regex/java-spring';
export { parsePython } from './regex/python-django';
export { parseCSharp } from './regex/dotnet-mediatr';
export { extractFieldAccess as extractPgFieldAccess, type FieldAccess } from './regex/postgres/extract';
export { translateTriggers, type PgTriggerRow } from './regex/postgres/translate';
export { dotFieldAccess, getterSetterAccess, deriveResource } from './regex/text';

// Ponto de entrada do núcleo. extractors/, agent/ e os apps importam daqui.
export * from './interactions/model';
export * from './interactions/graph';
export * from './interactions/detector';
export * from './interactions/validate';

export * from './code-graph/types';
export * from './code-graph/CodeGraph';
export * from './code-graph/parser';
export * from './code-graph/cycles';
export * from './code-graph/resolve-import';
export * from './code-graph/extract-module';
export { parseCss, parseHtml, resolveWebRef } from './code-graph/extract-web';
export * from './code-graph/indexer';

export { tokenize as tokenizeSql, type Token as SqlToken } from './sql/lexer';

export * from './topology/types';
export * from './topology/routes';
export * from './topology/io';
export * from './topology/build';
export * from './topology/surface';
export * from './topology/affected';
export * from './chaos-config';
export * from './sql/classify';

export * from './system-graph';
export * from './map-diff';
export * from './git-base';
export * from './findings';
export * from './host';
export * from './paths';

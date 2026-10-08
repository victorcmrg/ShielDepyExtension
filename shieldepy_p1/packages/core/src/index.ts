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
export * from './code-graph/indexer';

export * from './system-graph';
export * from './findings';
export * from './host';
export * from './paths';

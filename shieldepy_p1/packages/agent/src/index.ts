// Camada de IA. O core nunca importa daqui; os apps escolhem o provider e chamam os casos de uso.
export * from './provider';
export * from './select';
export * from './cost';
export * from './text';
export { AnthropicProvider, DEFAULT_ANTHROPIC_MODELS, type AnthropicProviderOptions } from './providers/anthropic';
export { GeminiProvider, DEFAULT_GEMINI_MODEL, type GeminiProviderOptions } from './providers/gemini';

export * from './collisions/types';
export { AGENT_NAME, AGENT_TAGLINE, PERSONA } from './collisions/persona';
export { buildPrompt, buildSystemPrompt, buildFactsMessage, parseResponse } from './collisions/prompt';
export { explainOffline } from './collisions/offline';
export { explainCollisions } from './collisions/explain';
export { collisionChatReply, offlineChatReply, buildChatSystemInstruction, type ChatFacts } from './collisions/chat';
export { collisionsToFindings } from './collisions/findings';

export * from './code/scan';
export * from './code/review';
export * from './code/inline';
export * from './code/chat';

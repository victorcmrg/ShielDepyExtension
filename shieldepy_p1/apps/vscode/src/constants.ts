// Identificadores que aparecem em mais de um lugar (package.json, registro, webviews).

export const VIEW_PANEL = 'shieldepy.panel';
export const VIEW_CHAT = 'shieldepy.chat';
export const VIEW_SETTINGS = 'shieldepy.settings';

export const CMD = {
  reviewImpact: 'shieldepy.reviewImpact',
  explainCollisions: 'shieldepy.explainCollisions',
  toggleInline: 'shieldepy.toggleInlineSuggestions',
  scanWorkspace: 'shieldepy.scanWorkspace',
  setApiKey: 'shieldepy.setApiKey',
  attachFinding: 'shieldepy.attachFinding',
  focusChat: 'shieldepy.chat.focus',
  login: 'shieldepy.login',
  logout: 'shieldepy.logout',
  openDashboard: 'shieldepy.openDashboard',
  refreshAccess: 'shieldepy.refreshAccess',
  focusPanel: 'shieldepy.panel.focus',
  focusSettings: 'shieldepy.settings.focus',
  openLocation: 'shieldepy.openLocation',
  showMap: 'shieldepy.showMap',
} as const;

export const SECRET_ANTHROPIC = 'shieldepy.anthropicApiKey';
export const SECRET_GEMINI = 'shieldepy.geminiApiKey';
export const SECRET_AUTH_TOKEN = 'shieldepy.authToken';

/** Linguagens com grafo estrutural (Tree-sitter / HTML / CSS). */
export const GRAPH_LANGUAGES = ['typescript', 'typescriptreact', 'javascript', 'javascriptreact', 'html', 'css'];
/** Linguagens que só alimentam o grafo de interações (extratores Tree-sitter de Java/Python/C#). */
export const RULE_ONLY_LANGUAGES = ['java', 'python', 'csharp'];
/** Onde a sugestão inline roda — só código, nunca `.env`, JSON, markdown… (item 3.2). */
export const INLINE_LANGUAGES = ['typescript', 'typescriptreact', 'javascript', 'javascriptreact', 'java', 'python', 'csharp'];

/** tsconfig/jsconfig (inclusive `tsconfig.base.json`): mudou → o grafo refaz a resolução de imports. */
export const MODULE_CONFIG_GLOB = '**/{tsconfig,jsconfig}*.json';
export const FILE_GLOB = '**/*.{ts,tsx,js,jsx,mjs,cjs,html,htm,css,java,py,cs}';
export const EXCLUDE_GLOB = '**/{node_modules,dist,out,.git,bin,obj,.venv,venv,__pycache__}/**';
export const MAX_ANALYZABLE_BYTES = 2 * 1024 * 1024;

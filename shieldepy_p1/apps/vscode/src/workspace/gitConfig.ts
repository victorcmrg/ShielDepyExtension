// Leitura do .git sem executar o git: o remote (identidade do repositório no servidor) e a branch
// atual (aparece no painel web: "em uso por ana na main"). Puro — sem vscode, sem fs — testável.

/** URLs dos remotes de um `.git/config` ("origin" → url). */
export function parseRemotes(configText: string): Map<string, string> {
  const remotes = new Map<string, string>();
  let current: string | null = null;
  for (const raw of configText.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const section = /^\[\s*remote\s+"([^"]+)"\s*\]$/i.exec(line);
    if (section) {
      current = section[1]!;
      continue;
    }
    if (line.startsWith('[')) {
      current = null;
      continue;
    }
    const url = /^url\s*=\s*(.+)$/i.exec(line);
    if (current && url && !remotes.has(current)) remotes.set(current, url[1]!.trim());
  }
  return remotes;
}

/** O remote que identifica o repositório: "origin" se existir, senão o primeiro. */
export function primaryRemote(remotes: Map<string, string>): string | null {
  return remotes.get('origin') ?? remotes.values().next().value ?? null;
}

/** Branch do HEAD ("ref: refs/heads/main" → "main"); HEAD solto (detached) → null. */
export function parseHead(headText: string): string | null {
  const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(headText.trim());
  return ref ? ref[1]! : null;
}

/** Arquivo `.git` (worktree/submódulo) aponta pro diretório real: "gitdir: ../.git/worktrees/x". */
export function parseGitFile(text: string): string | null {
  const m = /^gitdir:\s*(.+)$/m.exec(text);
  return m ? m[1]!.trim() : null;
}

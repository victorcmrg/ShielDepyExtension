// Identidade de um repositório = a URL do remote do .git, normalizada. Os mesmos repositórios
// chegam escritos de jeitos diferentes (https, ssh, com .git, com usuário, maiúsculas):
//   https://github.com/Acme/Pricing.git     → github.com/acme/pricing
//   git@github.com:Acme/Pricing.git          → github.com/acme/pricing
//   ssh://git@github.com:22/acme/pricing     → github.com/acme/pricing
// Sem dependência de banco — testável sozinho.

const MAX_REMOTE = 300;

export function normalizeRemote(raw: string): string | null {
  let s = raw.trim();
  if (!s || s.length > MAX_REMOTE) return null;

  // scp-like: user@host:path (sem "://")
  const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/)(.+)$/.exec(s);
  if (!s.includes('://') && scp) {
    s = `${scp[1]}/${scp[2]}`;
  } else {
    s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, ''); // protocolo
    s = s.replace(/^[^@/]+@/, ''); // credenciais/usuário
    s = s.replace(/^([^/:]+):\d+(?=\/)/, '$1'); // porta
  }

  s = s
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '')
    .replace(/\/+/g, '/')
    .toLowerCase();

  // host + pelo menos dono/repo, só caracteres de caminho comuns
  if (!/^[a-z0-9.-]+(\/[a-z0-9._~-]+){2,}$/.test(s)) return null;
  return s;
}

/** Nome curto pra exibir ("acme/pricing") a partir do remote normalizado. */
export function remoteLabel(normalized: string): string {
  return normalized.split('/').slice(1).join('/');
}

import { describe, expect, it } from 'vitest';
import { normalizeRemote, remoteLabel } from '../server/auth/remotes';

describe('normalizeRemote', () => {
  it('https, ssh e scp-like do mesmo repositório viram a mesma identidade', () => {
    const variants = [
      'https://github.com/Acme/Pricing.git',
      'https://github.com/acme/pricing',
      'https://user:token@github.com/acme/pricing.git/',
      'git@github.com:Acme/Pricing.git',
      'ssh://git@github.com:22/acme/pricing.git',
      'github.com/acme/pricing',
    ];
    for (const v of variants) expect(normalizeRemote(v)).toBe('github.com/acme/pricing');
  });

  it('aceita subgrupos (GitLab) e hosts próprios', () => {
    expect(normalizeRemote('https://gitlab.empresa.com.br/time/backend/api.git')).toBe('gitlab.empresa.com.br/time/backend/api');
  });

  it('recusa o que não é um remote', () => {
    for (const bad of ['', 'pricing', 'https://github.com/', 'C:\\repos\\pricing', 'github.com/acme', 'a'.repeat(400)]) {
      expect(normalizeRemote(bad)).toBeNull();
    }
  });

  it('rótulo curto sem o host', () => {
    expect(remoteLabel('github.com/acme/pricing')).toBe('acme/pricing');
  });
});

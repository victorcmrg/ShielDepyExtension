import { describe, expect, it } from 'vitest';
import { parseGitFile, parseHead, parseRemotes, primaryRemote } from '../src/workspace/gitConfig';

const CONFIG = `[core]
\trepositoryformatversion = 0
[remote "upstream"]
\turl = git@github.com:outra/pedidos.git
[remote "origin"]
\turl = https://github.com/Acme/Pedidos.git
\tfetch = +refs/heads/*:refs/remotes/origin/*
[branch "main"]
\tremote = origin
\turl = nao-e-remote
`;

describe('.git/config', () => {
  it('lê os remotes e prefere o origin', () => {
    const remotes = parseRemotes(CONFIG);
    expect(remotes.get('upstream')).toBe('git@github.com:outra/pedidos.git');
    expect(primaryRemote(remotes)).toBe('https://github.com/Acme/Pedidos.git');
  });

  it('url fora de seção [remote] não conta', () => {
    expect([...parseRemotes(CONFIG).values()]).not.toContain('nao-e-remote');
  });

  it('sem origin, usa o primeiro; sem remote, null', () => {
    expect(primaryRemote(parseRemotes('[remote "fork"]\n url = https://x.dev/a/b'))).toBe('https://x.dev/a/b');
    expect(primaryRemote(parseRemotes('[core]\n bare = false'))).toBeNull();
  });
});

describe('HEAD e arquivo .git', () => {
  it('branch do HEAD; detached vira null', () => {
    expect(parseHead('ref: refs/heads/fix/imposto\n')).toBe('fix/imposto');
    expect(parseHead('3f2a9c0e1b...')).toBeNull();
  });

  it('gitdir de worktree/submódulo', () => {
    expect(parseGitFile('gitdir: ../.git/worktrees/feature\n')).toBe('../.git/worktrees/feature');
    expect(parseGitFile('qualquer coisa')).toBeNull();
  });
});

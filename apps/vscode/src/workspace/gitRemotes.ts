import { readFile, stat } from 'node:fs/promises';
import * as path from 'node:path';
import { parseGitFile, parseHead, parseRemotes, primaryRemote } from './gitConfig';

/** O repositório de uma pasta aberta no VS Code, como o servidor vai identificá-lo. */
export interface WorkspaceRepo {
  /** A pasta do workspace (o que é liberado ou não). */
  folder: string;
  /** Raiz do repositório (pode ser acima da pasta aberta). */
  root: string | null;
  remote: string | null;
  branch: string | null;
}

const MAX_LEVELS = 8;

async function isDir(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

async function readText(p: string): Promise<string | null> {
  try {
    return await readFile(p, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Sobe a partir da pasta até achar o `.git` (abrir uma subpasta do repositório também vale).
 * `.git` pode ser diretório ou arquivo "gitdir:" (worktree/submódulo); numa worktree, o config
 * com os remotes fica no diretório comum (arquivo `commondir`).
 */
export async function findRepo(folder: string): Promise<WorkspaceRepo> {
  let dir = folder;
  for (let i = 0; i < MAX_LEVELS; i++) {
    const dotGit = path.join(dir, '.git');
    let gitDir: string | null = null;
    if (await isDir(dotGit)) gitDir = dotGit;
    else {
      const pointer = await readText(dotGit);
      const target = pointer ? parseGitFile(pointer) : null;
      if (target) gitDir = path.resolve(dir, target);
    }
    if (gitDir) {
      const common = await readText(path.join(gitDir, 'commondir'));
      const configDir = common ? path.resolve(gitDir, common.trim()) : gitDir;
      const config = await readText(path.join(configDir, 'config'));
      const head = await readText(path.join(gitDir, 'HEAD'));
      return { folder, root: dir, remote: config ? primaryRemote(parseRemotes(config)) : null, branch: head ? parseHead(head) : null };
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return { folder, root: null, remote: null, branch: null };
}

export function findRepos(folders: string[]): Promise<WorkspaceRepo[]> {
  return Promise.all(folders.map(findRepo));
}

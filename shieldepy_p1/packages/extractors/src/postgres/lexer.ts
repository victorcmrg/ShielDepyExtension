// Analisador léxico de PL/pgSQL. Não há gramática Tree-sitter de PL/pgSQL no `tree-sitter-wasms`
// (e as de SQL não entram no corpo `$$ ... $$` de uma função) — mas o que os triggers mexem
// (`NEW.col := ...`) é LÉXICO: basta separar o código em tokens corretamente. É o que garante
// que comentário, string e identificador com aspas nunca virem acesso (a regex antiga errava isso).

export type Token =
  | { kind: 'ident'; value: string; quoted: boolean }
  | { kind: 'op'; value: string }
  | { kind: 'string' }
  | { kind: 'number' };

const isIdentStart = (c: string) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_' || c > '\x7f';
const isIdentPart = (c: string) => isIdentStart(c) || (c >= '0' && c <= '9') || c === '$';
const isDigit = (c: string) => c >= '0' && c <= '9';
const isSpace = (c: string) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';

/**
 * Tokeniza SQL/PL-pgSQL. `$tag$ ... $tag$` no nível de cima é o CORPO da função
 * (`pg_get_functiondef`, `CREATE FUNCTION ... AS $$`) e é tokenizado como código; dentro dele,
 * dollar-quote é string (SQL dinâmico de `EXECUTE`).
 */
export function tokenize(src: string, bodyIsCode = true): Token[] {
  const out: Token[] = [];
  let i = 0;
  const n = src.length;

  while (i < n) {
    const c = src[i]!;
    const next = src[i + 1];

    if (isSpace(c)) {
      i++;
    } else if (c === '-' && next === '-') {
      while (i < n && src[i] !== '\n') i++;
    } else if (c === '/' && next === '*') {
      // comentário de bloco — no Postgres eles ANINHAM
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (src[i] === '/' && src[i + 1] === '*') (depth++, (i += 2));
        else if (src[i] === '*' && src[i + 1] === '/') (depth--, (i += 2));
        else i++;
      }
    } else if (c === "'" || ((c === 'E' || c === 'e') && next === "'")) {
      const escapes = c !== "'";
      i += escapes ? 2 : 1;
      while (i < n) {
        if (escapes && src[i] === '\\') i += 2;
        else if (src[i] === "'" && src[i + 1] === "'") i += 2;
        else if (src[i] === "'") break;
        else i++;
      }
      i++;
      out.push({ kind: 'string' });
    } else if (c === '"') {
      let value = '';
      i++;
      while (i < n) {
        if (src[i] === '"' && src[i + 1] === '"') (value += '"', (i += 2));
        else if (src[i] === '"') break;
        else value += src[i++];
      }
      i++;
      out.push({ kind: 'ident', value, quoted: true });
    } else if (c === '$' && (next === '$' || (next !== undefined && isIdentStart(next)))) {
      const tagEnd = src.indexOf('$', i + 1);
      const tag = tagEnd < 0 ? '' : src.slice(i, tagEnd + 1);
      const tagValid = tag.length >= 2 && [...tag.slice(1, -1)].every(isIdentPart);
      if (!tagValid) {
        out.push({ kind: 'op', value: c });
        i++;
        continue;
      }
      const close = src.indexOf(tag, tagEnd + 1);
      const body = src.slice(tagEnd + 1, close < 0 ? n : close);
      if (bodyIsCode) out.push(...tokenize(body, false));
      else out.push({ kind: 'string' });
      i = close < 0 ? n : close + tag.length;
    } else if (isIdentStart(c)) {
      const start = i;
      while (i < n && isIdentPart(src[i]!)) i++;
      out.push({ kind: 'ident', value: src.slice(start, i), quoted: false });
    } else if (isDigit(c)) {
      while (i < n && (isDigit(src[i]!) || src[i] === '.' || src[i] === 'e' || src[i] === 'E')) i++;
      out.push({ kind: 'number' });
    } else if (c === ':' && next === '=') {
      out.push({ kind: 'op', value: ':=' });
      i += 2;
    } else {
      out.push({ kind: 'op', value: c });
      i++;
    }
  }
  return out;
}

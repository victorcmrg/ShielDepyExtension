// Código que ninguém escreveu à mão: bibliotecas minificadas copiadas para o repositório
// (`media/vendor/cytoscape.min.js`) e saídas de bundler. No mapa, só viram ruído: milhares de
// ligações por nome entre funções de uma letra e centenas de "ciclos" sem sentido (Q1 do plano,
// medido no próprio ShielDepy). Pelo nome do arquivo ou pela forma do texto — sem ler o código.

/** `lib.min.js`, `app.bundle.js`, `abc.chunk.js`, `x-min.js`. */
const GENERATED_NAME = /(?:[.-]min|\.bundle|\.chunk)\.(?:m|c)?js$/i;

/** Uma linha deste tamanho não é escrita à mão (o formatador quebra bem antes). */
const LONG_LINE = 1000;
/** Média de caracteres por linha acima disto = texto minificado. */
const MAX_AVERAGE_LINE = 200;

/**
 * Minificado = a MAIOR PARTE do texto está em linhas gigantes, ou a média por linha é absurda.
 * Uma linha longa sozinha (base64, SVG embutido num .tsx) não tira um arquivo escrito à mão do mapa.
 */
export function looksGenerated(fsPath: string, text: string): boolean {
  if (GENERATED_NAME.test(fsPath)) return true;
  if (text.length < LONG_LINE) return false;
  let lines = 0;
  let inLongLines = 0;
  for (let start = 0; start <= text.length; ) {
    let end = text.indexOf('\n', start);
    if (end === -1) end = text.length;
    if (end - start > LONG_LINE) inLongLines += end - start;
    lines += 1;
    start = end + 1;
  }
  return inLongLines > text.length / 2 || text.length / lines > MAX_AVERAGE_LINE;
}

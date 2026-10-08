// Ferramenta no navegador: escolhe um exemplo, cola código ou arrasta arquivos → /analyze roda o motor
// → diagnóstico + chat ancorado nas colisões provadas. A chave da IA vive no servidor; aqui só vão
// arquivos e mensagens.
import { useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { postJson } from '../api';

interface SourceFile {
  name: string;
  content: string;
}

interface Diagnosis {
  status: string;
  severity: string;
  confidence: number;
  affectedKey: string;
  conflictingSources: string;
  rootCause: string;
  recommendation: string;
}

interface AnalyzeResult {
  sessionId: string;
  report: { summary: string; engine: string; diagnoses: Diagnosis[] };
  factsCount: number;
  skipped?: string[];
}

interface Bubble {
  id: number;
  who: 'bot' | 'user';
  text: string;
  pending?: boolean;
}

const EXAMPLES: [string, string][] = [
  ['node', 'Microsserviços (Node)'],
  ['java', 'Java / Spring'],
  ['python', 'Python / Django'],
  ['csharp', '.NET / MediatR'],
];
const LANG_EXT: Record<string, string> = { ts: 'ts', java: 'java', py: 'py', cs: 'cs' };
const SEV_ICON: Record<string, string> = { Crítico: '🔴', Alto: '🟠', Médio: '🟡', Baixo: '🟢' };
const ENGINES: Record<string, string> = { anthropic: 'IA (Claude)', gemini: 'IA (Gemini)', offline: 'explicador offline (determinístico)' };

export default function Tool() {
  const [example, setExample] = useState<string | null>(null);
  const [files, setFiles] = useState<SourceFile[]>([]);
  const [paste, setPaste] = useState('');
  const [lang, setLang] = useState('ts');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [chat, setChat] = useState<Bubble[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const chatEl = useRef<HTMLDivElement>(null);
  const bubbleId = useRef(0);

  // cada bolha nova rola o chat até o fim
  useEffect(() => {
    if (chatEl.current) chatEl.current.scrollTop = chatEl.current.scrollHeight;
  }, [chat.length]);

  async function addFiles(list: FileList | null) {
    if (!list) return;
    const added: SourceFile[] = [];
    for (const file of Array.from(list)) added.push({ name: file.name, content: await file.text() });
    setFiles((f) => [...f, ...added]);
  }

  function pickExample(key: string, label: string) {
    const next = example === key ? null : key;
    setExample(next);
    setMsg(next ? `Exemplo selecionado: ${label}` : '');
  }

  const bubble = (who: Bubble['who'], text: string, pending = false): Bubble => ({ id: ++bubbleId.current, who, text, pending });

  async function analyze() {
    const all = [...files];
    const code = paste.trim();
    if (code) all.push({ name: `colado.${LANG_EXT[lang] || 'ts'}`, content: code });

    let payload;
    if (example) payload = { example };
    else if (all.length > 0) payload = { files: all };
    else return setMsg('Escolha um exemplo, cole código ou arraste ao menos um arquivo.');

    setBusy(true);
    setMsg('Analisando com o motor...');
    try {
      const data = await postJson<AnalyzeResult>('/analyze', payload, 'falha na análise');
      setResult(data);
      // abre o chat e o semeia
      setChat([
        bubble(
          'bot',
          data.factsCount > 0
            ? `Analisei o sistema e o motor provou ${data.factsCount} colisão(ões). Pergunte o que quiser sobre os achados.`
            : 'Analisei o sistema e o motor não provou nenhuma colisão nos eventos avaliados.'
        ),
      ]);
      setMsg(data.skipped?.length ? `Ignorados (extensão não suportada): ${data.skipped.join(', ')}` : '');
    } catch (err) {
      setMsg('Erro: ' + (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    const message = chatInput.trim();
    if (!message || !result) return;
    const pending = bubble('bot', '', true);
    setChat((c) => [...c, bubble('user', message), pending]);
    setChatInput('');
    setChatBusy(true);
    let reply: string;
    try {
      reply = (await postJson<{ reply: string }>('/chat', { sessionId: result.sessionId, message }, 'falha no chat')).reply;
    } catch (err) {
      reply = 'Erro: ' + (err as Error).message;
    }
    setChat((c) => c.map((b) => (b.id === pending.id ? { ...b, text: reply, pending: false } : b)));
    setChatBusy(false);
  }

  const dragOn = (e: DragEvent) => {
    e.preventDefault();
    setOver(true);
  };
  const dragOff = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
  };

  return (
    <>
      {/* ZONA 1: o ambiente a testar */}
      <section className="panel" id="env-panel">
        <h2>1 · O que testar</h2>

        <div className="block">
          <label>Exemplos prontos</label>
          <div className="examples">
            {EXAMPLES.map(([key, label]) => (
              <button key={key} className={'ex' + (example === key ? ' active' : '')} data-ex={key} onClick={() => pickExample(key, label)}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="block">
          <label htmlFor="paste">Colar código</label>
          <div className="paste-head">
            <select id="lang" value={lang} onChange={(e) => setLang(e.target.value)}>
              <option value="ts">Node / TS (event bus)</option>
              <option value="java">Java (Spring)</option>
              <option value="py">Python (Django)</option>
              <option value="cs">C# (MediatR)</option>
            </select>
          </div>
          <textarea id="paste" placeholder="Cole aqui o código de um handler/listener..." value={paste} onChange={(e) => setPaste(e.target.value)} />
        </div>

        <div className="block">
          <label>Arrastar arquivos</label>
          <div
            id="drop"
            className={'drop' + (over ? ' over' : '')}
            onDragEnter={dragOn}
            onDragOver={dragOn}
            onDragLeave={dragOff}
            onDrop={(e) => {
              dragOff(e);
              void addFiles(e.dataTransfer.files);
            }}
          >
            Arraste arquivos <code>.java .py .cs .ts .tsx .js .jsx</code> ou <code>.json</code> aqui
            <br />
            <small>
              ou{' '}
              <a
                href="#"
                id="pick"
                onClick={(e) => {
                  e.preventDefault();
                  fileInput.current?.click();
                }}
              >
                clique para escolher
              </a>
            </small>
            <input
              type="file"
              id="file-input"
              multiple
              hidden
              ref={fileInput}
              onChange={(e) => {
                void addFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </div>
          <ul id="file-list" className="file-list">
            {files.map((f, i) => (
              <li key={i + f.name}>
                <span>{f.name}</span>
                <button title="remover" onClick={() => setFiles((list) => list.filter((_, k) => k !== i))}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </div>

        <button id="analyze" className="primary" onClick={analyze} disabled={busy}>
          Analisar
        </button>
        <p id="analyze-msg" className="msg">
          {msg}
        </p>
      </section>

      {/* ZONA 2: diagnóstico + conversa */}
      <section className="panel" id="result-panel">
        <h2>2 · Diagnóstico</h2>
        {result ? (
          <p id="summary" className="summary">
            {result.report.summary}
          </p>
        ) : (
          <p id="summary" className="summary muted">
            Escolha um exemplo, cole código ou arraste arquivos e clique em <b>Analisar</b>.
          </p>
        )}
        <div id="cards">
          {result && (
            <>
              <p className="engine-tag">
                origem do texto: {ENGINES[result.report.engine] || ENGINES.offline} · {result.factsCount} colisão(ões)
              </p>
              {result.report.diagnoses.map((d, i) => (
                <div key={i} className={`card sev-${d.severity}`}>
                  <div className="head">
                    <span>{SEV_ICON[d.severity] || ''}</span>
                    <span className="pill">Status: {d.status}</span>
                    <span className="pill">Severidade: {d.severity}</span>
                    <span className="pill">Confiança: {Number(d.confidence) || 0}%</span>
                  </div>
                  <div className="row">
                    <b>Chave/Namespace Afetado:</b> {d.affectedKey}
                  </div>
                  <div className="row">
                    <b>Origens em Conflito:</b> {d.conflictingSources}
                  </div>
                  <div className="row">
                    <b>Causa Raiz:</b> {d.rootCause}
                  </div>
                  <div className="row">
                    <b>Recomendação Declarativa:</b> {d.recommendation}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>

        <div id="chat-wrap" className={result ? undefined : 'hidden'}>
          <h2>3 · Conversar com o ShielDepy</h2>
          <p className="muted small">A IA só discute as colisões que o motor provou — ela não inventa bugs.</p>
          <div id="chat" className="chat" ref={chatEl}>
            {chat.map((b) =>
              b.who === 'bot' ? (
                <div key={b.id} className="bubble bot">
                  <span className="who">🛡️ shieldPy</span>
                  <span className="text">
                    {b.pending ? (
                      <span className="typing">
                        <span />
                        <span />
                        <span />
                      </span>
                    ) : (
                      b.text
                    )}
                  </span>
                </div>
              ) : (
                <div key={b.id} className="bubble user">
                  {b.text}
                </div>
              )
            )}
          </div>
          <form id="chat-form" className="chat-form" onSubmit={send}>
            <input
              id="chat-input"
              type="text"
              autoComplete="off"
              placeholder="Pergunte algo sobre os achados... (ex.: por que a colisão em 'total' é crítica?)"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
            />
            <button type="submit" disabled={chatBusy}>
              Enviar
            </button>
          </form>
        </div>
      </section>
    </>
  );
}

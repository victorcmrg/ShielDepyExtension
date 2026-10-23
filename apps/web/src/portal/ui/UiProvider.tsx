// Toasts, modal de confirmação/formulário e o `run` (ação + toast) — o padrão de toda ação dos painéis.
// Um provider só no topo do portal; as páginas pegam tudo com useUi().
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';

type ToastKind = 'ok' | 'error';

export interface ModalField {
  name: string;
  label: string;
  /** text/password/email (padrão text), 'select' (options) ou 'checkboxes' (options → array de valores). */
  type?: 'text' | 'password' | 'email' | 'select' | 'checkboxes';
  placeholder?: string;
  value?: string;
  required?: boolean;
  autocomplete?: string;
  hint?: string;
  options?: { value: string | number; label: string; checked?: boolean }[];
  emptyText?: string;
}

export interface ModalOptions {
  title: string;
  body?: string;
  confirmLabel?: string;
  danger?: boolean;
  fields?: ModalField[];
}

/** Valores do formulário (checkboxes viram array); sem campos, um objeto vazio = "confirmou". */
export type ModalValues = Record<string, string | string[]>;

interface Ui {
  toast(message: string, kind?: ToastKind): void;
  /** Roda `fn` e mostra toast de sucesso/erro. Devolve true/false em vez de relançar: o toast já avisou. */
  run(fn: () => unknown, successMessage?: string): Promise<boolean>;
  modal(options: ModalOptions): Promise<ModalValues | null>;
}

const UiContext = createContext<Ui | null>(null);

export function useUi(): Ui {
  const ui = useContext(UiContext);
  if (!ui) throw new Error('useUi fora do UiProvider');
  return ui;
}

interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
}

interface OpenModal {
  options: ModalOptions;
  resolve: (values: ModalValues | null) => void;
}

export function UiProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [openModal, setOpenModal] = useState<OpenModal | null>(null);
  const nextId = useRef(0);

  const toast = useCallback((message: string, kind: ToastKind = 'ok') => {
    const id = ++nextId.current;
    setToasts((list) => [...list, { id, message, kind }]);
  }, []);
  const dropToast = useCallback((id: number) => setToasts((list) => list.filter((t) => t.id !== id)), []);

  const run = useCallback(
    async (fn: () => unknown, successMessage?: string) => {
      try {
        await fn();
        if (successMessage) toast(successMessage, 'ok');
        return true;
      } catch (err) {
        toast(err instanceof Error ? err.message : String(err), 'error');
        return false;
      }
    },
    [toast]
  );

  const modal = useCallback(
    (options: ModalOptions) => new Promise<ModalValues | null>((resolve) => setOpenModal({ options, resolve })),
    []
  );

  const ui = useMemo(() => ({ toast, run, modal }), [toast, run, modal]);

  return (
    <UiContext.Provider value={ui}>
      {children}
      {createPortal(
        <div className="toast-host" id="toastHost" role="status" aria-live="polite">
          {toasts.map((t) => (
            <Toast key={t.id} item={t} onDone={dropToast} />
          ))}
        </div>,
        document.body
      )}
      {openModal &&
        createPortal(
          <Modal
            key={openModal.options.title}
            options={openModal.options}
            onClose={(values) => {
              openModal.resolve(values);
              setOpenModal(null);
            }}
          />,
          document.body
        )}
    </UiContext.Provider>
  );
}

function Toast({ item, onDone }: { item: ToastItem; onDone: (id: number) => void }) {
  const [phase, setPhase] = useState<'' | 'show' | 'hide'>('');
  useEffect(() => {
    const raf = requestAnimationFrame(() => setPhase('show'));
    let removeTimer = 0;
    const hideTimer = window.setTimeout(
      () => {
        setPhase('hide');
        removeTimer = window.setTimeout(() => onDone(item.id), 320);
      },
      item.kind === 'error' ? 4800 : 2800
    );
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(hideTimer);
      clearTimeout(removeTimer);
    };
  }, [item, onDone]);
  return (
    <div className={'toast ' + (item.kind === 'error' ? 'toast-error' : 'toast-ok') + (phase ? ' ' + phase : '')}>
      <Icon name={item.kind === 'error' ? 'x' : 'check'} />
      <span>{item.message}</span>
    </div>
  );
}

function initialValues(fields: ModalField[]): ModalValues {
  const values: ModalValues = {};
  for (const f of fields) {
    if (f.type === 'checkboxes') values[f.name] = (f.options ?? []).filter((o) => o.checked).map((o) => String(o.value));
    else if (f.type === 'select') values[f.name] = f.value ?? String(f.options?.[0]?.value ?? '');
    else values[f.name] = f.value ?? '';
  }
  return values;
}

function Modal({ options, onClose }: { options: ModalOptions; onClose: (values: ModalValues | null) => void }) {
  const { title, body, confirmLabel, danger, fields = [] } = options;
  const [values, setValues] = useState<ModalValues>(() => initialValues(fields));
  const [open, setOpen] = useState(false);
  const closing = useRef(false);
  const firstFieldRef = useRef<HTMLInputElement & HTMLSelectElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);
  // o provider re-renderiza a cada toast: o callback vai num ref pra não refazer o efeito (e roubar o foco)
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const close = useCallback((result: ModalValues | null) => {
    if (closing.current) return;
    closing.current = true;
    setOpen(false);
    setTimeout(() => onCloseRef.current(result), 220);
  }, []);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setOpen(true));
    // foco no primeiro campo; sem campos (confirmação) ou com uma lista de opções primeiro, no botão de confirmar
    (firstFieldRef.current ?? okRef.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(null);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKey);
    };
  }, [close]);

  const set = (name: string, value: string | string[]) => setValues((v) => ({ ...v, [name]: value }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    close(values);
  };

  return (
    <div
      className={'modal-overlay' + (open ? ' open' : '')}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close(null);
      }}
    >
      <div className="modal" role="dialog" aria-modal="true">
        <h3 className="modal-title">{title}</h3>
        {body && <p className="modal-body">{body}</p>}
        <form className="modal-form" onSubmit={submit}>
          {fields.map((f, i) =>
            f.type === 'checkboxes' ? (
              <fieldset key={f.name} className="field field-group">
                <legend className="field-label">{f.label}</legend>
                <div className="check-list">
                  {(f.options ?? []).map((opt) => {
                    const v = String(opt.value);
                    const checked = (values[f.name] as string[]).includes(v);
                    return (
                      <label key={v} className="check-row">
                        <input
                          type="checkbox"
                          value={v}
                          checked={checked}
                          onChange={(e) => {
                            const list = values[f.name] as string[];
                            set(f.name, e.target.checked ? [...list, v] : list.filter((x) => x !== v));
                          }}
                        />
                        <span>{opt.label}</span>
                      </label>
                    );
                  })}
                  {!(f.options ?? []).length && <p className="field-hint">{f.emptyText || 'Nada para escolher.'}</p>}
                </div>
                {f.hint && <span className="field-hint">{f.hint}</span>}
              </fieldset>
            ) : (
              <label key={f.name} className="field">
                <span className="field-label">{f.label}</span>
                {f.type === 'select' ? (
                  <select ref={i === 0 ? firstFieldRef : undefined} value={values[f.name] as string} onChange={(e) => set(f.name, e.target.value)}>
                    {(f.options ?? []).map((opt) => (
                      <option key={opt.value} value={String(opt.value)}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    ref={i === 0 ? firstFieldRef : undefined}
                    type={f.type || 'text'}
                    placeholder={f.placeholder || ''}
                    value={values[f.name] as string}
                    required={f.required}
                    autoComplete={f.autocomplete}
                    onChange={(e) => set(f.name, e.target.value)}
                  />
                )}
                {f.hint && <span className="field-hint">{f.hint}</span>}
              </label>
            )
          )}
          <div className="modal-actions">
            <button className="btn-ghost" type="button" onClick={() => close(null)}>
              Cancelar
            </button>
            <button ref={okRef} className={danger ? 'btn-danger' : 'btn-brand'} type="submit">
              {confirmLabel || 'Confirmar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

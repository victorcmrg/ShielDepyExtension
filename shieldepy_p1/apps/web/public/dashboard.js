// Utilitários compartilhados pelos painéis (admin.html e account.html): chamadas à API,
// toasts, modal de confirmação, contadores animados e formatação. Script clássico — cabe
// na CSP (script-src 'self') sem módulo nem bundler, como o resto de apps/web/public.
window.sd = (function () {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  async function api(url, options) {
    const opts = { credentials: 'same-origin', ...options };
    if (opts.body && typeof opts.body !== 'string') {
      opts.body = JSON.stringify(opts.body);
      opts.headers = { 'content-type': 'application/json', ...(opts.headers || {}) };
    }
    const res = await fetch(url, opts);
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      window.location.href = '/login.html?redirect=' + encodeURIComponent(location.pathname);
      throw new Error('sessão expirada');
    }
    if (!res.ok) throw new Error(data.error || 'falha na requisição');
    return data;
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function icon(name) {
    const paths = {
      users: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19c.8-3 3-4.6 5.5-4.6s4.7 1.6 5.5 4.6"/><circle cx="16.5" cy="9.5" r="2.4"/><path d="M15.5 14.6c2.3.2 4 1.6 4.7 4.4"/>',
      building: '<rect x="4.5" y="3.5" width="15" height="17" rx="2"/><path d="M8.5 7.5h2M13.5 7.5h2M8.5 11h2M13.5 11h2M8.5 14.5h2M13.5 14.5h2M10.5 20.5v-3h3v3"/>',
      mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="m4 7 8 6 8-6"/>',
      device: '<rect x="3.5" y="4.5" width="17" height="11" rx="1.8"/><path d="M8.5 19.5h7M12 15.5v4"/>',
      spark: '<path d="M12 3.5c.7 3 1.9 4.2 4.9 4.9-3 .7-4.2 1.9-4.9 4.9-.7-3-1.9-4.2-4.9-4.9 3-.7 4.2-1.9 4.9-4.9Z"/><path d="M18.5 14.5c.4 1.7 1.1 2.4 2.8 2.8-1.7.4-2.4 1.1-2.8 2.8-.4-1.7-1.1-2.4-2.8-2.8 1.7-.4 2.4-1.1 2.8-2.8Z"/>',
      pause: '<circle cx="12" cy="12" r="8.5"/><path d="M10 9v6M14 9v6"/>',
      shield: '<path d="M12 3.2 19 6v5.6c0 4.5-2.9 7.4-7 8.7-4.1-1.3-7-4.2-7-8.7V6l7-2.8Z"/><path d="m8.7 12 2.2 2.2 4.2-4.4"/>',
      lock: '<rect x="5.2" y="10.8" width="13.6" height="9.5" rx="2.4"/><path d="M8 10.8V7.8a4 4 0 0 1 8 0v3"/>',
      plus: '<path d="M12 5v14M5 12h14"/>',
      trash: '<path d="M4.5 7h15M9.5 7V5h5v2M6.5 7l1 12.5h9l1-12.5"/>',
      edit: '<path d="M4.5 19.5h4l10-10-4-4-10 10v4Z"/><path d="m13 6.5 4 4"/>',
      chevron: '<path d="m9 6 6 6-6 6"/>',
      check: '<path d="m5.5 12.5 4 4 9-9"/>',
      x: '<path d="M6 6l12 12M18 6 6 18"/>',
      arrow: '<path d="M4.5 12h14.5M13 6l6 6-6 6"/>',
      key: '<circle cx="8" cy="15" r="3.5"/><path d="m10.5 12.5 8-8M16 7l2.5 2.5M14 9l2 2"/>',
      code: '<path d="m9 8-4.5 4L9 16"/><path d="m15 8 4.5 4L15 16"/>',
      search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>',
      folder: '<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.2h7a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z"/>',
      branch: '<circle cx="7" cy="6" r="2.2"/><circle cx="7" cy="18" r="2.2"/><circle cx="17" cy="8" r="2.2"/><path d="M7 8.2v7.6M17 10.2c0 3.6-4.5 3.4-8.4 6.2"/>',
      repo: '<path d="M6.5 4.5h11a1 1 0 0 1 1 1v13.2a.8.8 0 0 1-1.2.7L12 16.6l-5.3 2.8a.8.8 0 0 1-1.2-.7V5.5a1 1 0 0 1 1-1Z"/>',
      logout: '<path d="M14.5 5.5h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-3"/><path d="M10 8.5 6.5 12l3.5 3.5M6.5 12h9"/>',
      menu: '<path d="M4.5 7h15M4.5 12h15M4.5 17h15"/>',
      external: '<path d="M13.5 5.5h5v5M18.5 5.5 11 13"/><path d="M17.5 13.5v4a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2h4"/>',
      user: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 19.5c1-3.6 3.8-5.5 7-5.5s6 1.9 7 5.5"/>',
      grid: '<rect x="4.5" y="4.5" width="6.5" height="6.5" rx="1.5"/><rect x="13" y="4.5" width="6.5" height="6.5" rx="1.5"/><rect x="4.5" y="13" width="6.5" height="6.5" rx="1.5"/><rect x="13" y="13" width="6.5" height="6.5" rx="1.5"/>',
      globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.3 2.4 3.4 5.3 3.4 8.5s-1.1 6.1-3.4 8.5c-2.3-2.4-3.4-5.3-3.4-8.5s1.1-6.1 3.4-8.5Z"/>',
    };
    const span = el('span', 'sd-icon');
    span.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      (paths[name] || '') +
      '</svg>';
    return span;
  }

  // ---------- toasts ----------
  function toastHost() {
    let host = document.getElementById('toastHost');
    if (!host) {
      host = el('div', 'toast-host');
      host.id = 'toastHost';
      host.setAttribute('role', 'status');
      host.setAttribute('aria-live', 'polite');
      document.body.appendChild(host);
    }
    return host;
  }

  function toast(message, kind) {
    const t = el('div', 'toast ' + (kind === 'error' ? 'toast-error' : 'toast-ok'));
    t.appendChild(icon(kind === 'error' ? 'x' : 'check'));
    t.appendChild(el('span', '', message));
    toastHost().appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => {
      t.classList.remove('show');
      t.classList.add('hide');
      setTimeout(() => t.remove(), 320);
    }, kind === 'error' ? 4800 : 2800);
  }

  /**
   * Roda `fn` e mostra toast de sucesso/erro — padrão de toda ação dos painéis. Devolve
   * true/false em vez de relançar: quem chama é handler de clique, e o toast já avisou.
   */
  async function run(fn, successMessage) {
    try {
      await fn();
      if (successMessage) toast(successMessage, 'ok');
      return true;
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
      return false;
    }
  }

  // ---------- modal ----------
  function modal({ title, body, confirmLabel, danger, fields }) {
    return new Promise((resolve) => {
      const overlay = el('div', 'modal-overlay');
      const box = el('div', 'modal');
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-modal', 'true');
      box.appendChild(el('h3', 'modal-title', title));
      if (body) box.appendChild(el('p', 'modal-body', body));

      const inputs = {};
      const form = el('form', 'modal-form');
      for (const f of fields || []) {
        // Campos: texto/senha (padrão), 'select' (options) e 'checkboxes' (options → array de valores).
        const wrap = el(f.type === 'checkboxes' ? 'fieldset' : 'label', 'field' + (f.type === 'checkboxes' ? ' field-group' : ''));
        wrap.appendChild(el(f.type === 'checkboxes' ? 'legend' : 'span', 'field-label', f.label));
        if (f.type === 'checkboxes') {
          const boxes = [];
          const list = el('div', 'check-list');
          for (const opt of f.options || []) {
            const row = el('label', 'check-row');
            const box = el('input');
            box.type = 'checkbox';
            box.value = String(opt.value);
            box.checked = Boolean(opt.checked);
            boxes.push(box);
            row.append(box, el('span', '', opt.label));
            list.appendChild(row);
          }
          if (!(f.options || []).length) list.appendChild(el('p', 'field-hint', f.emptyText || 'Nada para escolher.'));
          wrap.appendChild(list);
          inputs[f.name] = { get value() { return boxes.filter((b) => b.checked).map((b) => b.value); } };
        } else if (f.type === 'select') {
          const select = el('select');
          for (const opt of f.options || []) {
            const o = el('option', '', opt.label);
            o.value = String(opt.value);
            select.appendChild(o);
          }
          if (f.value) select.value = f.value;
          inputs[f.name] = select;
          wrap.appendChild(select);
        } else {
          const input = el('input');
          input.type = f.type || 'text';
          input.placeholder = f.placeholder || '';
          input.value = f.value || '';
          if (f.required) input.required = true;
          if (f.autocomplete) input.autocomplete = f.autocomplete;
          inputs[f.name] = input;
          wrap.appendChild(input);
        }
        if (f.hint) wrap.appendChild(el('span', 'field-hint', f.hint));
        form.appendChild(wrap);
      }
      const actions = el('div', 'modal-actions');
      const cancel = el('button', 'btn-ghost', 'Cancelar');
      cancel.type = 'button';
      const ok = el('button', danger ? 'btn-danger' : 'btn-brand', confirmLabel || 'Confirmar');
      ok.type = 'submit';
      actions.append(cancel, ok);
      form.appendChild(actions);
      box.appendChild(form);
      overlay.appendChild(box);
      document.body.appendChild(overlay);
      requestAnimationFrame(() => overlay.classList.add('open'));
      const first = Object.values(inputs)[0];
      (first && typeof first.focus === 'function' ? first : ok).focus();

      function close(value) {
        overlay.classList.remove('open');
        document.removeEventListener('keydown', onKey);
        setTimeout(() => overlay.remove(), 220);
        resolve(value);
      }
      function onKey(e) {
        if (e.key === 'Escape') close(null);
      }
      document.addEventListener('keydown', onKey);
      cancel.addEventListener('click', () => close(null));
      overlay.addEventListener('mousedown', (e) => {
        if (e.target === overlay) close(null);
      });
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const values = {};
        for (const [name, input] of Object.entries(inputs)) values[name] = input.value;
        close(values);
      });
    });
  }

  // ---------- números animados ----------
  function countUp(node, target) {
    const to = Number(target) || 0;
    const from = Number(node.dataset.value || 0);
    node.dataset.value = String(to);
    if (reduceMotion || from === to) {
      node.textContent = String(to);
      return;
    }
    const start = performance.now();
    const duration = 700;
    function frame(now) {
      const p = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      node.textContent = String(Math.round(from + (to - from) * eased));
      if (p < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  // ---------- datas ----------
  function relativeTime(ts) {
    if (!ts) return 'nunca';
    const diff = Date.now() - ts;
    const min = Math.round(diff / 60000);
    if (min < 1) return 'agora mesmo';
    if (min < 60) return 'há ' + min + ' min';
    const h = Math.round(min / 60);
    if (h < 24) return 'há ' + h + ' h';
    const d = Math.round(h / 24);
    if (d < 30) return 'há ' + d + (d === 1 ? ' dia' : ' dias');
    return new Date(ts).toLocaleDateString('pt-BR');
  }

  function formatDate(ts) {
    return ts ? new Date(ts).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  }

  /** Switch acessível e animado. `onChange` devolve false quando a API recusa — aí ele volta. */
  function switchControl(label, checked, onChange) {
    const wrap = el('label', 'sd-switch');
    const input = el('input');
    input.type = 'checkbox';
    input.checked = checked;
    const track = el('span', 'sd-switch-track');
    track.appendChild(el('span', 'sd-switch-thumb'));
    wrap.append(input, track, el('span', 'sd-switch-label', label));
    input.addEventListener('change', async () => {
      const next = input.checked;
      wrap.classList.add('busy');
      const ok = await onChange(next);
      if (ok === false) input.checked = !next;
      wrap.classList.remove('busy');
    });
    return wrap;
  }

  /** Entrada escalonada dos cards (classe `enter` + atraso por índice via custom property). */
  function stagger(nodes) {
    nodes.forEach((n, i) => {
      n.style.setProperty('--i', String(Math.min(i, 12)));
      n.classList.add('enter');
    });
  }

  return { api, el, icon, toast, run, modal, countUp, relativeTime, formatDate, switchControl, stagger, reduceMotion };
})();

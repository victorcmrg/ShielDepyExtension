// Chamadas à API do próprio servidor (mesma origem, cookie de sessão). Sessão expirada (401) manda pro
// login voltando pra tela atual; qualquer outro erro vira Error com a mensagem que o servidor mandou.

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
}

export async function api<T = { ok: true }>(url: string, { method, body }: ApiOptions = {}): Promise<T> {
  const init: RequestInit = { credentials: 'same-origin', method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'content-type': 'application/json' };
  }
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    window.location.href = '/login?redirect=' + encodeURIComponent(location.pathname);
    throw new Error('sessão expirada');
  }
  if (!res.ok) throw new Error(data.error || 'falha na requisição');
  return data as T;
}

/** POST de formulário fora do api(): login e device-confirm tratam o 401 como erro de tela, não como sessão expirada. */
export async function postJson<T>(url: string, body: unknown, fallbackError: string): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || fallbackError);
  return data as T;
}

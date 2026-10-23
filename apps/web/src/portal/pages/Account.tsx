// Minha conta: status do acesso, VS Codes conectados, equipe e senha.
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { initial, relativeTime, staggerStyle } from '../format';
import type { Account as AccountData } from '../types';
import { EmptyState } from '../ui/controls';
import { Icon, type IconName } from '../ui/Icon';
import { useUi } from '../ui/UiProvider';

function strength(pw: string): number {
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++;
  return score;
}

interface StatusCardProps {
  icon: IconName;
  label: string;
  value: string;
  sub: string;
  tone: 'ok' | 'danger' | 'brand' | 'muted';
  index: number;
}

function StatusCard({ icon, label, value, sub, tone, index }: StatusCardProps) {
  return (
    <div className={'stat-card status-' + tone + ' enter'} style={staggerStyle(index)}>
      <div className="stat-top">
        <Icon name={icon} />
        <span className="stat-label">{label}</span>
      </div>
      <div className="stat-value small">
        <span className="status-dot" />
        <span>{value}</span>
      </div>
      <div className="stat-sub">{sub}</div>
    </div>
  );
}

export default function Account() {
  const { modal, run, toast } = useUi();
  const [account, setAccount] = useState<AccountData | null>(null);
  const [leavingDevice, setLeavingDevice] = useState<number | null>(null);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setAccount(await api<AccountData>('/api/account'));
    setLeavingDevice(null);
  }, []);

  useEffect(() => {
    void run(load);
  }, [run, load]);

  async function disconnect(device: AccountData['devices'][number]) {
    const ok = await modal({
      title: 'Desconectar "' + device.label + '"?',
      body: 'Esse VS Code perde o acesso na hora e precisa entrar de novo.',
      confirmLabel: 'Desconectar',
      danger: true,
    });
    if (!ok) return;
    setLeavingDevice(device.id);
    await run(async () => {
      await api('/api/account/devices/' + device.id, { method: 'DELETE' });
      await load();
    }, 'VS Code desconectado');
  }

  async function savePassword(e: FormEvent) {
    e.preventDefault();
    if (next !== confirm) {
      toast('A confirmação não bate com a nova senha.', 'error');
      return;
    }
    setSaving(true);
    const ok = await run(() => api('/api/account/password', { method: 'POST', body: { currentPassword: current, newPassword: next } }), 'Senha salva');
    setSaving(false);
    if (ok) {
      setCurrent('');
      setNext('');
      setConfirm('');
      await run(load);
    }
  }

  const level = next ? strength(next) : 0;
  const access = account ? account.permissions.accessEnabled !== false : true;
  const ai = Boolean(account?.permissions.aiEnabled);
  const hasPassword = account ? account.hasPassword : true;

  return (
    <>
      <section className="page-head spaced">
        <div>
          <h1 className="page-title" id="greeting">
            {account ? 'Olá, ' + account.email.split('@')[0] : 'Minha conta'}
          </h1>
          <p className="page-sub">
            <span id="companyEyebrow">{account?.companyName}</span>. Seu acesso, os VS Codes conectados e a segurança da conta.
          </p>
        </div>
        <Link to="/projects" id="openToolBtn" className="btn-ghost">
          <Icon name="grid" />
          <span>Ver meus projetos</span>
        </Link>
      </section>

      <section className="stat-grid three" id="status">
        {!account ? (
          <>
            <div className="stat-card skeleton" />
            <div className="stat-card skeleton" />
            <div className="stat-card skeleton" />
          </>
        ) : (
          <>
            <StatusCard
              index={0}
              icon={access ? 'shield' : 'lock'}
              label="Acesso da empresa"
              value={access ? 'Liberado' : 'Suspenso'}
              sub={access ? 'A extensão e a ferramenta web funcionam normalmente.' : 'Fale com o administrador pra reativar.'}
              tone={access ? 'ok' : 'danger'}
            />
            <StatusCard
              index={1}
              icon="spark"
              label="Bot de IA"
              value={!access ? 'Pausado' : ai ? 'Liberado' : 'Não liberado'}
              sub={
                !access
                  ? 'Sem efeito enquanto o acesso da empresa estiver suspenso.'
                  : ai
                    ? 'Chat, explicações e sugestões com IA.'
                    : 'Ciclos e colisões seguem sendo provados sem IA.'
              }
              tone={ai && access ? 'brand' : 'muted'}
            />
            <StatusCard
              index={2}
              icon="device"
              label="VS Codes conectados"
              value={String(account.devices.length)}
              sub={account.devices.length ? 'último uso ' + relativeTime(account.devices[0]!.lastUsedAt) : 'nenhum ainda — veja como conectar ao lado'}
              tone={account.devices.length ? 'ok' : 'muted'}
            />
          </>
        )}
      </section>

      <div className="dash-columns">
        <section className="dash-section panel-card" id="devicesSection">
          <div className="dash-section-head">
            <h2>VS Codes conectados</h2>
          </div>
          <div id="devices">
            {account &&
              (account.devices.length === 0 ? (
                <EmptyState compact icon="device" title="Nenhum VS Code conectado" text="Quando você entrar pela extensão, ele aparece aqui." />
              ) : (
                <ul className="device-list">
                  {account.devices.map((d, i) => (
                    <li key={d.id} className={'device enter' + (leavingDevice === d.id ? ' leaving' : '')} style={staggerStyle(i)}>
                      <Icon name="device" />
                      <div className="device-info">
                        <strong>{d.label}</strong>
                        <span>{'conectado ' + relativeTime(d.createdAt) + ' · último uso ' + relativeTime(d.lastUsedAt)}</span>
                      </div>
                      <button className="text-btn danger" type="button" onClick={() => disconnect(d)}>
                        Desconectar
                      </button>
                    </li>
                  ))}
                </ul>
              ))}
          </div>
        </section>

        <section className="dash-section panel-card" id="connectSection">
          <div className="dash-section-head">
            <h2>Conectar o VS Code</h2>
          </div>
          <ol className="steps">
            <li>
              <span className="step-n">1</span>
              <div>
                <strong>Instale a extensão ShielDepy</strong>
                <p>Abra a pasta do projeto no VS Code e aperte F5, ou instale o .vsix.</p>
              </div>
            </li>
            <li>
              <span className="step-n">2</span>
              <div>
                <strong>Abra Configurações do ShielDepy</strong>
                <p>Ícone escudo + engrenagem na barra lateral → seção Conta.</p>
              </div>
            </li>
            <li>
              <span className="step-n">3</span>
              <div>
                <strong>Clique em "Entrar" e confie</strong>
                <p>O navegador abre nesta conta; clique em "Confiar" e o VS Code já fica liberado.</p>
              </div>
            </li>
          </ol>
        </section>

        <section className="dash-section panel-card" id="teamSection">
          <div className="dash-section-head">
            <h2>Sua equipe</h2>
          </div>
          <ul id="team" className="team-list">
            {account?.teammates.map((t, i) => (
              <li key={t.email} className={'team-member ' + t.status + ' enter'} style={staggerStyle(i)}>
                <span className="team-avatar">{initial(t.email)}</span>
                <span className="team-email">{t.email + (t.email === account.email ? ' (você)' : '')}</span>
                <span className={'badge ' + (t.status === 'active' ? 'badge-ok' : 'badge-muted')}>{t.status === 'active' ? 'ativo' : 'pendente'}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="dash-section panel-card" id="securitySection">
          <div className="dash-section-head">
            <h2 id="passwordTitle">{hasPassword ? 'Trocar senha' : 'Definir senha'}</h2>
          </div>
          <form id="passwordForm" className="password-form" onSubmit={savePassword}>
            <label className="field" id="currentField" hidden={!hasPassword}>
              <span className="field-label">Senha atual</span>
              <input type="password" id="currentPassword" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
            </label>
            <label className="field">
              <span className="field-label">Nova senha</span>
              <input type="password" id="newPassword" autoComplete="new-password" minLength={8} required value={next} onChange={(e) => setNext(e.target.value)} />
            </label>
            <label className="field">
              <span className="field-label">Confirmar nova senha</span>
              <input type="password" id="confirmPassword" autoComplete="new-password" minLength={8} required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </label>
            <div className="strength" id="strength" data-level={String(level)}>
              {[0, 1, 2, 3].map((i) => (
                <span key={i} className={i < level ? 'on' : undefined} />
              ))}
            </div>
            <button type="submit" className="btn-brand" id="passwordBtn" disabled={saving}>
              Salvar senha
            </button>
          </form>
        </section>
      </div>
    </>
  );
}

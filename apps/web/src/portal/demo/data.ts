// Os dados da demonstração do pós-login (decisão 0049): o site estático da Square Cloud não tem a API,
// então o "Entrar" leva a um painel de empresas e funcionários de mentira. Só dados e contas puras
// (sem DOM), testados em apps/web/test/demo.test.ts. Os e-mails usam domínios reservados (.test).
import type { Overview } from '../types';

export interface DemoMember {
  name: string;
  email: string;
  role: 'owner' | 'member';
  /** 'pending': convite ainda não usado. */
  status: 'active' | 'pending';
  /** VS Codes conectados (tokens de dispositivo válidos). */
  devices: number;
  /** Minutos desde o último sinal da extensão; null para quem nunca entrou. */
  lastSeenMinutesAgo: number | null;
  /** Projeto aberto no VS Code agora (ou o último). */
  project: string | null;
}

export interface DemoCompany {
  id: number;
  name: string;
  /** Acesso liberado (falso = suspensa). */
  active: boolean;
  ai: boolean;
  createdDaysAgo: number;
  members: DemoMember[];
}

const m = (name: string, email: string, role: DemoMember['role'], devices: number, lastSeenMinutesAgo: number | null, project: string | null): DemoMember => ({
  name,
  email,
  role,
  status: lastSeenMinutesAgo === null ? 'pending' : 'active',
  devices,
  lastSeenMinutesAgo,
  project,
});

export const DEMO_COMPANIES: readonly DemoCompany[] = [
  {
    id: 1,
    name: 'Acme Pagamentos',
    active: true,
    ai: true,
    createdDaysAgo: 42,
    members: [
      m('Marina Duarte', 'marina@acme.test', 'owner', 2, 2, 'checkout-api'),
      m('Rafael Souza', 'rafael@acme.test', 'member', 1, 0, 'checkout-api'),
      m('Júlia Nogueira', 'julia@acme.test', 'member', 1, 7, 'carteira-web'),
      m('Pedro Lima', 'pedro@acme.test', 'member', 1, 180, 'antifraude'),
      m('Bruna Castro', 'bruna@acme.test', 'member', 0, null, null),
    ],
  },
  {
    id: 2,
    name: 'Vértice Logística',
    active: true,
    ai: false,
    createdDaysAgo: 19,
    members: [
      m('Carlos Mendes', 'carlos@vertice.test', 'owner', 1, 4, 'rotas-service'),
      m('Aline Rocha', 'aline@vertice.test', 'member', 2, 11, 'rotas-service'),
      m('Thiago Alves', 'thiago@vertice.test', 'member', 1, 1440, 'painel-frota'),
    ],
  },
  {
    id: 3,
    name: 'Nimbus Saúde',
    active: true,
    ai: true,
    createdDaysAgo: 8,
    members: [
      m('Fernanda Prado', 'fernanda@nimbus.test', 'owner', 1, 13, 'prontuario-api'),
      m('Lucas Ferreira', 'lucas@nimbus.test', 'member', 1, 55, 'agenda-web'),
      m('Sofia Martins', 'sofia@nimbus.test', 'member', 0, null, null),
      m('Gabriel Ribeiro', 'gabriel@nimbus.test', 'member', 0, null, null),
    ],
  },
  {
    id: 4,
    name: 'Orbe Educação',
    active: false,
    ai: false,
    createdDaysAgo: 63,
    members: [
      m('Renata Lopes', 'renata@orbe.test', 'owner', 1, 3, 'plataforma-aulas'),
      m('Diego Barros', 'diego@orbe.test', 'member', 1, 4320, 'plataforma-aulas'),
    ],
  },
];

/** Os números do topo, contados da lista (como o /api/admin/overview faz no banco). */
export function overviewOf(list: readonly DemoCompany[]): Overview {
  const all = list.flatMap((c) => c.members);
  return {
    companies: list.length,
    suspendedCompanies: list.filter((c) => !c.active).length,
    users: all.filter((x) => x.status === 'active').length,
    pendingInvites: all.filter((x) => x.status === 'pending').length,
    activeDevices: all.reduce((n, x) => n + x.devices, 0),
    aiCompanies: list.filter((c) => c.ai).length,
  };
}

/** Quem está com o VS Code conectado agora (visto nos últimos 15 min, empresa liberada), do mais recente. */
export function connectedNow(list: readonly DemoCompany[]): { company: DemoCompany; member: DemoMember }[] {
  return list
    .filter((c) => c.active)
    .flatMap((company) => company.members.map((member) => ({ company, member })))
    .filter(({ member }) => member.status === 'active' && member.devices > 0 && member.lastSeenMinutesAgo !== null && member.lastSeenMinutesAgo <= 15)
    .sort((a, b) => a.member.lastSeenMinutesAgo! - b.member.lastSeenMinutesAgo!);
}

/** A busca do painel: nome da empresa, ou nome ou e-mail de quem trabalha nela, sem caixa. */
export function filterCompanies(list: readonly DemoCompany[], query: string): DemoCompany[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...list];
  return list.filter((c) => c.name.toLowerCase().includes(q) || c.members.some((x) => x.name.toLowerCase().includes(q) || x.email.toLowerCase().includes(q)));
}

// O site sem API (decisão 0049): o build do pacote estático da Square Cloud liga VITE_DEMO_PORTAL=1, e aí
// o "Entrar" leva à demonstração (/demo) em vez de chamar o login, e as telas que dependem da API também.
// No web:dev e na API servindo o site, fica desligado e tudo funciona como antes.
export const DEMO_PORTAL = import.meta.env.VITE_DEMO_PORTAL === '1';

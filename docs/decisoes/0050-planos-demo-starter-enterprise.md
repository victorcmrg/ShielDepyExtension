# 0050 — Os planos: Demo, Starter e ShielDepy Enterprise

**Data:** 2026-11-13 (decisão do usuário) · **Estado:** valendo

**Contexto.** A landing tinha Starter (R$99), Completo (R$249, o mais escolhido) e Enterprise (sob consulta), e a tela "Plano e faturas" do portal mostrava o Completo. O usuário redefiniu os planos em torno das rodadas dos agentes do caos.

**Decisão.**
- **Base de todos:** o mapa visual (o gráfico das ligações do sistema).
- **Demo (grátis):** 5 rodadas por mês dos agentes do caos, extensão, ciclos e colisões sem IA, 1 projeto e a CLI.
- **Starter (US$30 por mês; US$24 no anual, com os 20% do toggle):** 120 rodadas por mês, o chatbot com IA (o primeiro plano pago em diante tem chatbot), a visualização de erro melhorada e os extras que já existiam no plano pago (projetos, repositórios e pessoas ilimitados, portão no CI, painel de uso), mais histórico das execuções e relatórios para compartilhar.
- **ShielDepy Enterprise (sob consulta, a melhor opção, com a borda verde):** pool personalizada de rodadas, totalmente seguro com servidor de IA dedicado, acesso ao gerenciador staff e suporte 24 horas; e, a pedido do usuário ("mais perks, genéricos mas no contexto do projeto"): implantação no ambiente do cliente, SSO e permissões por papel, registro de auditoria, leitura dos triggers do Postgres em produção, onboarding guiado e contrato sob medida.
- O "Plano e faturas" do portal (dados fixos, [0028](0028-demo-so-o-motor-e-nest-fora.md)) passa a mostrar o Starter a US$30.

**Consequências.**
- As rodadas por mês e a pool ainda não são medidas nem limitadas pelo sistema: por enquanto é só a oferta na landing.
- Os perks genéricos do Enterprise (SSO, auditoria, implantação no cliente) são promessa comercial, sem código por trás ainda.

# 0007 — Linguagens: C# e Java no motor, Python a seguir, motor próprio

**Data:** 2026-10-16 · **Estado:** valendo · **Substitui:** a decisão de 2026-10-09 ("só JS/TS; Java e C# fora do roadmap")

**Decisão.**
- C# (etapa L) e Java (etapa J) entram no motor: mapa, rotas e I/O. As duas foram entregues.
- A próxima linguagem é **Python**.
- O motor continua nosso, sobre o Tree-sitter. O Graphify entra só como comparação no TCC, porque gera um grafo geral para a IA, sem chamadas em ordem com argumentos, sem tipo do receptor e sem rotas e I/O por framework.

**Consequências.** O caos continua só JS/TS. Caos em C# e Java (xUnit/`WebApplicationFactory`, JUnit/Spring Test) é um "talvez".

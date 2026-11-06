# 0033 — Os atalhos da demo ficam no repositório

**Data:** 2026-11-06 (pedido do usuário) · **Estado:** valendo · **Ajusta:** a [0032](0032-demo-abre-em-projeto-real.md)

**Contexto.** Os atalhos `.cmd` da 0032 só existiam na Área de Trabalho de uma máquina, e o preparo do realworld tinha sido feito à mão. Depois de um `git pull` em outra máquina, não havia atalho nem projeto.

**Decisão.**
- **Os atalhos moram em `scripts/demo/atalhos/`,** com caminhos relativos ao próprio arquivo: funcionam em qualquer pasta. O `.gitattributes` mantém os `.cmd` em CRLF.
- **O atalho 1 prepara tudo antes de abrir:** `npm install`, `npm run demo:real` (clone no commit fixado, contrato, arnês e `prisma generate`), o `.vsix` do código atual e a instalação dele. A extensão instalada é sempre a do repositório.
- **O resultado do caos é apagado a cada abertura.** A extensão carrega o `.shieldepy/chaos-results.json` que achar, e um resultado antigo na lista parecia análise feita agora.
- **O `prisma generate` tenta até 5 vezes e confere se o cliente saiu.** O download do motor em `binaries.prisma.sh` cai às vezes com "socket hang up"; sem o cliente, os 5 testes dão inválido.

**Consequências.**
- A primeira abertura precisa de internet e leva alguns minutos; as seguintes refazem o `npm install` e o `.vsix`, em segundos.
- O arnês é instalado no `node_modules` do realworld com `--no-save` enquanto a DP8 não sai.
- O atalho do pg-crud, a reserva da 0032, não foi versionado.

# O mapa do sistema

O mapa mostra o caminho de cada rota HTTP:

**rota → controller → serviço → repositório → banco ou API externa**

Cada ligação vem do código, resolvida pelo tipo. Quando algo é só um palpite pelo nome, o mapa marca como tal.

- Clique num nó para ver os detalhes. **Abrir código** leva ao arquivo e à linha.
- Rotas que leem e depois gravam o mesmo dado, ou que chamam uma API sem timeout, aparecem como **sensíveis**. São elas que o teste de caos ataca.
- **Comparar mapa com uma branch** mostra o que a sua branch mudou na estrutura e quais rotas ela tocou.

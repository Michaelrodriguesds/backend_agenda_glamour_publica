# Histórico de atualizações — BelaAgenda

Registro das melhorias do BelaAgenda (versão pública, vários negócios), da mais
recente para a mais antiga. Vale para os dois repositórios (backend Node e app Flutter).

O BelaAgenda nasceu do Glamour Agenda (app feito para um salão só). As melhorias
abaixo trazem para cá o que foi feito no Glamour, **adaptado para cada negócio ter
a sua realidade**: serviços, locais, cor, nome e prazos próprios.

| Data | Versão | O que mudou | Onde |
| --- | --- | --- | --- |
| 06/11/2026 | 2.1 | Desempenho, layout para tablet/PC, estilos com a cor da marca, aba Clientes & Marketing, testes automáticos | Backend + App |
| — | 2.0 | Versão multi-negócio: cadastro, teste grátis, bloqueio e liberação manual, configuração do negócio | Backend + App |

---

## 2.1 — 06/11/2026

**Pedido:** deixar o BelaAgenda igual ao Glamour em desempenho, estilo e área de
marketing, **mantendo o fluxo do plano** (cadastro → teste grátis → bloqueio →
liberação pelo painel) e deixando cada negócio adaptar o app à própria realidade.

### O que NÃO mudou (de propósito)
- Cadastro, login, esqueci a senha, teste de 30 dias, tela de bloqueio com o ID,
  painel `/admin` (liberar +30 dias / bloquear), onboarding.
- Agendamentos, notas, disponibilidade e estatísticas que já existiam.
- Nenhum dado existente é apagado ou alterado. Só entram **2 coleções novas**
  (`clientpreferences` e `reminderlogs`) e **3 campos opcionais** na configuração
  do negócio (`ownerName` e `services[].returnDays`; quem não preencher continua igual).

### Desempenho
- **App abre mais rápido:** a primeira tela aparece na hora; datas, cache, internet
  e estilo salvo carregam **em paralelo** (antes era um de cada vez, com a tela branca).
- **Abas preguiçosas:** Calendário, Estatísticas, Notas e Clientes só são criadas
  (e só buscam dados) quando a pessoa abre a aba pela 1ª vez. Antes, as 5 abas
  buscavam tudo ao mesmo tempo assim que o app abria.
- **Início usa o cache** de agendamentos (mesma fonte do Calendário) e atualiza sozinho
  depois de editar algo em outra tela.
- **Cache com invalidação central:** salvou/apagou um agendamento → as telas que
  dependem dele recarregam; o resto continua no cache.
- **Tela Clientes:** antes baixava até 5000 agendamentos inteiros para somar no
  celular; agora a nova rota `GET /api/clients` soma no banco e devolve uma linha
  por cliente. Ficha da cliente usa `clientExact` (abrir "Ana" não traz "Ana Paula").
- **Gráfico do ano (Estatísticas):** a rota `/api/stats/trend` fazia até
  **36 consultas** (3 por mês); agora são **2 agregações** para o ano inteiro.
- **Formulário:** com 1 local só, deixa de fazer a 2ª busca de horários (que só
  serve para avisar sobre o outro local).

### Bugs corrigidos (vindos do Glamour)
- Agendamento "sumia" do calendário quando havia mais de 2 no mesmo horário
  (2 vagas por local = até 4 no horário): agora todos aparecem.
- No formulário, o horário avisa **+N em dourado** quando há agendamento no outro local.

### Tablet e PC
- Telas largas (≥ 800 px): menu lateral no lugar da barra de baixo, largura máxima
  de 1100 px, cards do Início em uma linha, calendário e horários lado a lado.
- Login, cadastro, esqueci a senha, bloqueio, configurações e formulários com
  largura de cartão. **No celular nada muda.**

### Estilos + cor da marca
- Botão 🎨 no Início: 6 estilos (Rosé = o original, Lavanda, Oceano, Esmeralda,
  Champanhe, Claro).
- **Chave "Usar a cor da minha marca"** (ligada por padrão): os botões e destaques
  usam a cor escolhida no cadastro do negócio. Antes essa cor só aparecia em
  parte do app (botões e barra); agora vale para todos os destaques.
- A cor é **ajustada automaticamente** só quando não dá leitura no estilo (ex.:
  amarelo-claro no fundo branco), mantendo o tom. A cor padrão (#B47FD4) fica igual.
- Estilo e chave ficam salvos no aparelho; a cor da marca continua salva no negócio.

### Saudação com o nome
- "Bom dia / Boa tarde / Boa noite, Ana! 🌸" no Início.
- Novo campo **"Seu nome (opcional)"** nas Configurações do negócio. Sem nome,
  usa a primeira parte do e-mail ("ana.souza@…" → "Ana").

### Aba Clientes & Marketing (custo zero, sem API paga de WhatsApp)
- Estatísticas ganhou as abas **Financeiro | Clientes & Marketing**.
- **Para enviar hoje:** agendadas para amanhã e clientes na hora de refazer, com
  "Copiar mensagem" (texto pronto, **assinado com o nome do negócio**) e "Enviei".
- **Dias para retorno por serviço:** cada negócio informa nos próprios serviços
  (Configurações → 🔁). Serviço sem prazo não gera lembrete. Sem nenhum prazo,
  a aba mostra onde configurar.
- **Movimento da semana, Suas clientes (fiéis, sumidas, novas) e Campanha sugerida.**
- Ficha da cliente: chaves "Recebe lembrete do agendamento / de retorno".
- **Cada negócio só vê os próprios dados** (todas as consultas filtram pelo dono da
  conta) e conta bloqueada recebe `403 TRIAL_EXPIRED`, como nas outras abas.

### Organização e testes
- Backend: `server.js` separado em `src/app.js` (rotas) + `server.js` (banco e
  porta), para testar sem banco real. **64 testes automáticos** (Jest + Supertest,
  banco simulado), incluindo "negócio A não vê dados do B" e "conta bloqueada não acessa".
  Os testes ponta a ponta antigos continuam em `npm run test:functional`.
- App: testes de estilos/cor da marca, saudação e marketing (`flutter test`).
- `build/` deixou de ir para o GitHub (estava comentado no `.gitignore`).

---

## Pendências e ideias
- Medir a velocidade antes/depois com números (ainda não medido).
- Cadastro de telefone da cliente (botão abriria o WhatsApp direto, ainda grátis).
- Mensagens editáveis por negócio (hoje os textos são iguais para todos, só a assinatura muda).
- Testes rodando sozinhos a cada push (GitHub Actions).

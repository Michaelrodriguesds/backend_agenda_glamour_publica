# Aba "Clientes & Marketing" — como funciona (BelaAgenda)

Custo zero: o app **não envia** mensagens. Ele mostra quem precisa de lembrete,
monta o texto e copia. O dono do negócio cola no WhatsApp da cliente.

## Cada negócio com a sua realidade

| O quê | Onde se configura | Quem decide |
| --- | --- | --- |
| Dias para retorno de cada serviço | App → Início → ⚙️ Configurações → serviço → 🔁 | Cada negócio |
| Quem recebe lembrete | App → Clientes → ficha da cliente (2 chaves) | Cada negócio |
| Assinatura das mensagens | Nome do negócio (Configurações) | Cada negócio |
| Janelas gerais (60 dias = sumida, 30 = nova…) | `src/config/marketing.js` | Você (vale para todos) |

Serviço com 0 dias (ou sem prazo) **não gera** lembrete de retorno. Se nenhum serviço
tiver prazo, a resposta traz `returnConfigured: false` e o app mostra onde configurar.

## Rotas (todas com `protect` + `checkTrial`)

| Rota | O que faz |
| --- | --- |
| `GET /api/marketing/reminders` | agendadas para amanhã + hora de refazer |
| `POST /api/marketing/reminders/sent` | marca "Enviei" (`{ key, type, clientName }`) |
| `DELETE /api/marketing/reminders/sent?key=` | desfaz "Enviei" |
| `GET /api/marketing/movement` | atendimentos por dia da semana e período (90 dias) |
| `GET /api/marketing/segments` | fiéis, sumidas e novas |
| `GET/PUT /api/marketing/prefs/:clientName` | chaves de lembrete da cliente |
| `GET /api/clients?search=` | lista de clientes somada no banco |

## Segurança entre negócios

- **Toda** consulta leva `userId` do token (nunca do corpo da requisição).
- `clientpreferences`: único por `userId + clientName` (a "Maria" do negócio A não é
  a "Maria" do B).
- `reminderlogs`: único por `userId + key`; apaga sozinho após 120 dias (TTL).
- Conta bloqueada recebe `403 TRIAL_EXPIRED`, como nas outras abas.
- Os testes `test/tenant.test.js` conferem tudo isso.

## Arquivos

| Arquivo | Papel |
| --- | --- |
| `src/config/marketing.js` | regras gerais (janelas em dias) |
| `src/services/marketing.js` | lógica pura (testada com datas fixas) |
| `src/controllers/marketingController.js` | lê o banco do negócio e chama a lógica |
| `src/models/ClientPreference.js`, `ReminderLog.js` | coleções novas |
| `src/controllers/clientController.js` | lista de clientes agregada |

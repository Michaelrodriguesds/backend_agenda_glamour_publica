# BelaAgenda — Backend

API Node.js/Express + MongoDB para o app BelaAgenda (agenda online multi-negócio).

## Estrutura

- `server.js` — conecta no MongoDB e abre a porta.
- `src/app.js` — Express: segurança, limites, rotas (usado pelos testes sem banco).
- Histórico de mudanças: `docs/HISTORICO.md`.

## Rodar localmente
```bash
npm install
cp .env.example .env      # preencha MONGO_URI, JWT_SECRET e ADMIN_KEY
npm run dev               # http://localhost:5000/health
```

## Painel de administração
Abra `https://SEU-SERVIDOR/admin`, digite a `ADMIN_KEY` e use **Liberar +30 dias** / **Bloquear**.
O cliente informa o **ID** (8 caracteres) que aparece na tela de bloqueio do app.

## Rotas principais
| Rota | Descrição |
|---|---|
| `POST /api/auth/register` · `login` · `forgot-password` · `reset-password` · `refresh` | conta e sessão |
| `GET /api/auth/me` | perfil, ID e status do plano |
| `GET/PUT /api/business/config` | logo, cor, nome do dono, serviços (com dias para retorno), locais, horário |
| `GET /api/clients` | lista de clientes do negócio (somada no banco) |
| `/api/marketing/*` | aba Clientes & Marketing (ver `docs/MARKETING.md`) |
| `/api/appointments`, `/api/notes`, `/api/availability`, `/api/stats/*` | dados (bloqueados se o teste expirar → `403 TRIAL_EXPIRED`) |
| `/api/admin/users…` | liberar/bloquear (header `x-admin-key`) |

---

## Testes e utilitários

**Testes automáticos (sem banco, sem servidor, não tocam em dados reais):**

```bash
npm test                 # Jest + Supertest: 64 testes (rotas, isolamento entre negócios, plano bloqueado, marketing)
```

**Testes ponta a ponta** — com o servidor rodando (`npm start`) e um banco de TESTE no `.env`:

```bash
npm run test:functional  # 100+ verificações funcionais (cadastro, trial, admin, isolamento entre contas...)
npm run test:logo        # upload de logo (base64)
# Teste de limites de taxa: suba um 2º servidor com
#   PORT=5057 RATE_LIMIT_MAX=50 npm start     e rode:
BASE=http://localhost:5057 ADMIN_KEY=suachave node tests/security.js
```

> Use SEMPRE um banco de teste (os testes criam contas e agendamentos).

Migrar dados da versão antiga (agendamentos/notas sem `userId`) para a sua conta:

```bash
npm run migrate:legacy -- seu@email.com           # simulação
npm run migrate:legacy -- seu@email.com --apply   # grava
```

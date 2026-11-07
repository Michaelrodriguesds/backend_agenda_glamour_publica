// ── App Express configurado, SEM efeitos colaterais ───────────────
// Aqui NÃO se conecta ao MongoDB nem se abre porta (isso fica em
// server.js). Assim os testes automáticos (Jest + Supertest) usam este
// `app` com banco simulado, sem tocar em dados reais.
const path       = require("path");
const express    = require("express");
const cors       = require("cors");
const helmet     = require("helmet");
const compression = require("compression");
const rateLimit  = require("express-rate-limit");
const mongoose   = require("mongoose");

// Registra os models antes de conectar (syncIndexes precisa deles)
require("./models/User");
require("./models/Appointment");
require("./models/Note");
require("./models/ClientPreference");
require("./models/ReminderLog");

const app = express();

// ATRÁS DO PROXY DO RENDER: sem isto, req.ip é sempre o IP do proxy e TODOS os
// usuários dividiriam a mesma cota do limitador de requisições.
app.set("trust proxy", 1);
app.disable("x-powered-by");

// ── Rate limiting ────────────────────────────────────────────────
const off = () => process.env.DISABLE_RATE_LIMIT === "1"; // só p/ testes de carga
const limiterBase = { standardHeaders: true, legacyHeaders: false, skip: off };

const limiter = rateLimit({
  ...limiterBase,
  windowMs: 60 * 1000,
  max:      Number(process.env.RATE_LIMIT_MAX || 300), // por IP/min (um app usa várias chamadas por tela)
  skip: (req) => off() || req.path === "/" || req.path === "/health",
  message: { error: "Muitas requisições", message: "Limite atingido. Tente novamente em 1 minuto.", retryAfter: 60 },
});

// Limites mais duros nas rotas sensíveis (força bruta de senha/código)
const byIpEmail = (req) => `${req.ip}|${String(req.body?.email || "").toLowerCase().trim()}`;
const tooMany = (msg) => ({ error: "Muitas tentativas", message: msg });
const loginLimiter  = rateLimit({ ...limiterBase, windowMs: 15 * 60 * 1000, max: 10, keyGenerator: byIpEmail,
  message: tooMany("Muitas tentativas de login. Aguarde 15 minutos.") });
const registerLimiter = rateLimit({ ...limiterBase, windowMs: 60 * 60 * 1000, max: 20,
  message: tooMany("Muitos cadastros deste dispositivo. Tente novamente mais tarde.") });
const forgotLimiter = rateLimit({ ...limiterBase, windowMs: 15 * 60 * 1000, max: 5, keyGenerator: byIpEmail,
  message: tooMany("Muitos pedidos de código. Aguarde 15 minutos.") });
const resetLimiter  = rateLimit({ ...limiterBase, windowMs: 15 * 60 * 1000, max: 10, keyGenerator: byIpEmail,
  message: tooMany("Muitas tentativas. Aguarde 15 minutos.") });
const adminLimiter  = rateLimit({ ...limiterBase, windowMs: 15 * 60 * 1000, max: 300,
  message: tooMany("Muitas requisições ao painel. Aguarde.") });

// ── Middlewares globais ──────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false })); // cabeçalhos de segurança (o painel admin usa script inline)
app.use(compression());                            // respostas JSON ~5-10x menores no 4G
app.use(cors({
  origin:         true,
  methods:        ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-admin-key"],
  credentials:    true,
}));
// A rota de configuração do negócio aceita logo em base64 (~até 300kb);
// precisa vir ANTES do parser global de 100kb.
app.use("/api/business", express.json({ limit: "400kb" }));
app.use(express.json({ limit: "100kb" }));
app.use("/api/", limiter);
app.post("/api/auth/login",           loginLimiter);
app.post("/api/auth/register",        registerLimiter);
app.post("/api/auth/forgot-password", forgotLimiter);
app.post("/api/auth/reset-password",  resetLimiter);
app.use("/api/admin",                 adminLimiter);

// ── Rotas ────────────────────────────────────────────────────────
app.use("/api/appointments",  require("./routes/appointmentRoutes"));
app.use("/api/stats",         require("./routes/statsRoutes"));
app.use("/api/availability",  require("./routes/availabilityRoutes"));
app.use("/api/auth",          require("./routes/authRoutes"));
app.use("/api/notes",         require("./routes/noteRoutes"));
app.use("/api/business",      require("./routes/businessRoutes"));
app.use("/api/admin",         require("./routes/adminRoutes"));
app.use("/api/clients",       require("./routes/clientRoutes"));    // lista de clientes calculada no banco
app.use("/api/marketing",     require("./routes/marketingRoutes")); // aba Clientes & Marketing

// Painel de administração (página estática; a chave só é usada nas chamadas /api/admin)
app.get("/admin", (_req, res) => res.sendFile(path.join(__dirname, "..", "public", "admin.html")));

// ── Health check (verifica MongoDB de verdade) ────────────────────
app.get("/health", (_req, res) => {
  const state = mongoose.connection.readyState; // 0=desconectado 1=conectado 2=conectando 3=desconectando
  const dbOk  = state === 1;
  res.status(dbOk ? 200 : 503).json({
    status:    dbOk ? "healthy" : "degraded",
    timestamp: new Date().toISOString(),
    uptime:    Math.floor(process.uptime()),
    db:        { status: dbOk ? "connected" : "disconnected", readyState: state },
    version:   "2.0.0",
  });
});

app.get("/", (_req, res) => {
  res.json({ status: "✅ BelaAgenda API online", version: "2.0.0", health: "/health" });
});

// ── 404 e erro global ────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: "Rota não encontrada" }));

app.use((err, req, res, _next) => {
  // JSON malformado / corpo grande demais → erro do cliente, não 500
  if (err.type === "entity.parse.failed") return res.status(400).json({ error: "JSON inválido" });
  if (err.type === "entity.too.large")    return res.status(413).json({ error: "Requisição grande demais" });
  console.error(`[${new Date().toISOString()}] ${req.method} ${req.path}:`, err.stack);
  res.status(500).json({ error: "Erro interno do servidor" });
});

module.exports = app;

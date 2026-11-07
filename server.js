require("dotenv").config();

// Falha cedo e com mensagem clara se faltar configuração essencial
for (const k of ["MONGO_URI", "JWT_SECRET"]) {
  if (!process.env[k]) { console.error(`❌ Variável de ambiente ${k} não configurada`); process.exit(1); }
}

const mongoose  = require("mongoose");
const connectDB = require("./src/config/database");
const app       = require("./src/app"); // rotas e middlewares (ver src/app.js)

// ── Banco de dados ───────────────────────────────────────────────
connectDB();

// ── Start ─────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, () => {
  console.log(`🌸 BelaAgenda API na porta ${PORT}`);
  console.log(`🔍 Health: http://localhost:${PORT}/health`);
});

// Desligamento limpo (Render envia SIGTERM a cada deploy)
const shutdown = (sig) => {
  console.log(`${sig} recebido, encerrando...`);
  server.close(() => mongoose.connection.close(false).finally(() => process.exit(0)));
  setTimeout(() => process.exit(1), 10000).unref();
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));
process.on("unhandledRejection", (r) => console.error("unhandledRejection:", r));

module.exports = app;

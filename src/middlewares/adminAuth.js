const crypto = require("crypto");

// Protege /api/admin/*. Não é login de usuário — é uma chave secreta só sua
// (ADMIN_KEY no .env), enviada no header x-admin-key.
// Comparação em tempo constante (evita descobrir a chave por tempo de resposta).
const safeEqual = (a, b) => {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
};

const adminAuth = (req, res, next) => {
  if (!process.env.ADMIN_KEY) {
    return res.status(500).json({ error: "ADMIN_KEY não configurada no servidor" });
  }
  const key = req.headers["x-admin-key"];
  if (!key || !safeEqual(key, process.env.ADMIN_KEY)) {
    return res.status(401).json({ error: "Chave de administrador inválida" });
  }
  next();
};

module.exports = adminAuth;

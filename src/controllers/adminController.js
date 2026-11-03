const User = require("../models/User");
const cache = require("../utils/userCache");

const DAY = 24 * 60 * 60 * 1000;

// Formato enxuto pra você ver no painel/Postman
const view = (u) => {
  const exp = User.accessExpiry(u);
  return {
    businessId: u.businessId,
    email: u.email,
    negocio: u.businessConfig?.businessName || "",
    status: User.effectiveStatus(u),          // trial | active | blocked (calculado na hora)
    expiraEm: exp ? new Date(exp) : null,
    diasRestantes: Math.ceil((exp - Date.now()) / DAY),
    criadoEm: u.createdAt,
  };
};

const findByBusinessId = (id) => User.findOne({ businessId: String(id).toUpperCase().trim() });

// ─── Listar usuários (mais urgentes primeiro) ──────────────────────
// GET /api/admin/users?search=texto&status=blocked|trial|active
exports.listUsers = async (req, res) => {
  try {
    const q = {};
    if (req.query.search) {
      const s = String(req.query.search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      q.$or = [
        { email: { $regex: s, $options: "i" } },
        { businessId: { $regex: s.toUpperCase() } },
        { "businessConfig.businessName": { $regex: s, $options: "i" } },
      ];
    }
    const users = await User.find(q)
      .select("businessId email trialEndsAt unlockedUntil businessConfig.businessName createdAt")
      .limit(1000)
      .lean();

    let rows = users.map(view).sort((a, b) => a.diasRestantes - b.diasRestantes);
    if (req.query.status) rows = rows.filter((r) => r.status === req.query.status);
    res.json({ count: rows.length, data: rows });
  } catch (error) {
    console.error("listUsers:", error);
    res.status(500).json({ error: "Erro ao listar usuários" });
  }
};

// ─── Buscar um usuário pelo businessId ─────────────────────────────
// GET /api/admin/users/:businessId
exports.getUserByBusinessId = async (req, res) => {
  try {
    const user = await findByBusinessId(req.params.businessId).lean();
    if (!user) return res.status(404).json({ error: "Nenhum usuário com esse ID" });
    res.json({ ...view(user), _id: user._id, trialEndsAt: user.trialEndsAt, unlockedUntil: user.unlockedUntil });
  } catch (error) {
    res.status(500).json({ error: "Erro ao buscar usuário" });
  }
};

// ─── Liberar +30 dias (ou "days") ──────────────────────────────────
// PATCH /api/admin/users/:businessId/unlock   Body opcional: { days: 30 }
// Soma em cima do que ainda resta (se ainda tem acesso); se já venceu,
// conta a partir de agora — assim ninguém perde dias nem ganha de graça.
exports.unlockUser = async (req, res) => {
  try {
    const user = await findByBusinessId(req.params.businessId);
    if (!user) return res.status(404).json({ error: "Nenhum usuário com esse ID" });

    const days = Number(req.body?.days);
    const d = Number.isFinite(days) && days > 0 && days <= 3650 ? days : 30;

    const base = user.hasActiveAccess() ? user.getAccessExpiry() : new Date();
    user.unlockedUntil = new Date(base.getTime() + d * DAY);
    user.planStatus = "active";
    await user.save();
    cache.invalidate(user._id);

    res.json({
      message: `Acesso liberado até ${user.unlockedUntil.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}`,
      businessId: user.businessId,
      unlockedUntil: user.unlockedUntil,
    });
  } catch (error) {
    console.error("unlockUser:", error);
    res.status(500).json({ error: "Erro ao liberar usuário" });
  }
};

// ─── Bloquear manualmente (ex: falta de pagamento) ─────────────────
// PATCH /api/admin/users/:businessId/block
exports.blockUser = async (req, res) => {
  try {
    const user = await findByBusinessId(req.params.businessId);
    if (!user) return res.status(404).json({ error: "Nenhum usuário com esse ID" });

    user.unlockedUntil = null;
    user.trialEndsAt = new Date(0); // já vencido
    user.planStatus = "blocked";
    await user.save();
    cache.invalidate(user._id);

    res.json({ message: "Usuário bloqueado", businessId: user.businessId });
  } catch (error) {
    res.status(500).json({ error: "Erro ao bloquear usuário" });
  }
};

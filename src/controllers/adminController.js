const User = require("../models/User");
const cache = require("../utils/userCache");
const crypto = require("crypto");
const Appointment = require("../models/Appointment");
const Note = require("../models/Note");
const ClientPreference = require("../models/ClientPreference");
const ReminderLog = require("../models/ReminderLog");
const Feedback = require("../models/Feedback");

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

// ─── Senha temporária (quando o e-mail de recuperação não chega) ───
// PATCH /api/admin/users/:businessId/reset-password
// Gera uma senha aleatória, grava (com hash) e devolve UMA vez para você
// passar ao cliente (ex.: por WhatsApp). Também cancela qualquer código de
// recuperação pendente. O cliente deve trocar a senha depois de entrar.
// Obs.: login em aparelhos já conectados continua valendo até o token expirar.
const TEMP_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"; // sem 0/O/1/l/I
const tempPassword = () => Array.from({ length: 10 }, () => TEMP_ALPHABET[crypto.randomInt(TEMP_ALPHABET.length)]).join("");

exports.resetPassword = async (req, res) => {
  try {
    const user = await findByBusinessId(req.params.businessId);
    if (!user) return res.status(404).json({ error: "Nenhum usuário com esse ID" });

    const temp = tempPassword();
    await user.setPassword(temp);
    user.resetCodeHash = null;
    user.resetCodeExpires = null;
    user.resetAttempts = 0;
    await user.save();

    res.set("Cache-Control", "no-store");
    res.json({ message: "Senha temporária gerada", businessId: user.businessId, email: user.email, tempPassword: temp });
  } catch (error) {
    console.error("resetPassword(admin):", error);
    res.status(500).json({ error: "Erro ao gerar senha temporária" });
  }
};

// ─── Excluir um usuário INATIVO e todos os dados dele ──────────────
// DELETE /api/admin/users/:businessId?confirm=<businessId>
// Trava dupla contra acidente:
//   1) só exclui quem está BLOQUEADO/vencido (quem ainda tem acesso → 409:
//      bloqueie antes);
//   2) exige ?confirm= com o mesmo ID (o painel pede para digitar).
// Apaga: agendamentos, notas, preferências de clientes, lembretes, relatos e
// a conta. Não tem volta — faça um export no Atlas antes se tiver dúvida.
exports.deleteUser = async (req, res) => {
  try {
    const user = await findByBusinessId(req.params.businessId);
    if (!user) return res.status(404).json({ error: "Nenhum usuário com esse ID" });

    if (String(req.query.confirm || "").toUpperCase().trim() !== user.businessId) {
      return res.status(400).json({ error: "Confirmação incorreta: informe o ID do usuário em ?confirm=" });
    }
    if (user.hasActiveAccess()) {
      return res.status(409).json({ error: "Este usuário ainda tem acesso ativo. Bloqueie primeiro e depois exclua." });
    }

    const id = user._id;
    const count = (r) => (r && r.deletedCount) || 0;
    const apagados = {
      agendamentos: count(await Appointment.deleteMany({ userId: id })),
      notas:        count(await Note.deleteMany({ userId: id })),
      clientes:     count(await ClientPreference.deleteMany({ userId: id })),
      lembretes:    count(await ReminderLog.deleteMany({ userId: id })),
      relatos:      count(await Feedback.deleteMany({ userId: id })),
    };
    await User.deleteOne({ _id: id });
    cache.invalidate(id);

    console.log(`admin: usuário ${user.businessId} excluído`, apagados);
    res.json({ message: "Usuário e dados excluídos", businessId: user.businessId, apagados });
  } catch (error) {
    console.error("deleteUser:", error);
    res.status(500).json({ error: "Erro ao excluir usuário" });
  }
};

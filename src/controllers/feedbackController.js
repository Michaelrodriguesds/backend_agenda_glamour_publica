const Feedback = require("../models/Feedback");
const User     = require("../models/User");

const TYPES = ["bug", "melhoria", "outro"];

// POST /api/feedback   (usuário logado — mesmo com o plano vencido, para ele
// poder avisar que está com problema)
exports.create = async (req, res) => {
  try {
    const message = String(req.body?.message ?? "").trim();
    if (message.length < 5)    return res.status(400).json({ error: "Escreva pelo menos 5 caracteres." });
    if (message.length > 1000) return res.status(400).json({ error: "Mensagem muito longa (máx. 1000 caracteres)." });

    const type = TYPES.includes(req.body?.type) ? req.body.type : "outro";
    const appVersion = String(req.body?.appVersion ?? "").slice(0, 30);

    // Nome do negócio vem do banco (nunca do corpo), sem puxar a logo.
    const u = await User.findById(req.user.id).select("businessId email businessConfig.businessName").lean();
    if (!u) return res.status(401).json({ error: "Sessão inválida. Faça login novamente." });

    await Feedback.create({
      userId:       req.user.id,
      businessId:   u.businessId,
      email:        u.email,
      businessName: u.businessConfig?.businessName || "",
      type, message, appVersion,
    });
    res.status(201).json({ message: "Recebemos seu relato. Obrigado!" });
  } catch (error) {
    if (error.name === "ValidationError") return res.status(400).json({ error: "Dados inválidos" });
    console.error("feedback.create:", error);
    res.status(500).json({ error: "Erro ao enviar o relato" });
  }
};

// ── Admin ────────────────────────────────────────────────────────
const view = (f) => ({
  id: String(f._id),
  businessId: f.businessId,
  email: f.email,
  negocio: f.businessName,
  tipo: f.type,
  mensagem: f.message,
  status: f.status,
  versao: f.appVersion,
  criadoEm: f.createdAt,
});

// GET /api/admin/feedback?status=novo|lido|resolvido
exports.list = async (req, res) => {
  try {
    const q = {};
    if (["novo", "lido", "resolvido"].includes(req.query.status)) q.status = req.query.status;
    const [rows, novos] = await Promise.all([
      Feedback.find(q).sort({ createdAt: -1 }).limit(300).lean(),
      Feedback.countDocuments({ status: "novo" }),
    ]);
    res.json({ novos, count: rows.length, data: rows.map(view) });
  } catch (error) {
    console.error("feedback.list:", error);
    res.status(500).json({ error: "Erro ao listar relatos" });
  }
};

// PATCH /api/admin/feedback/:id   { status }
exports.setStatus = async (req, res) => {
  try {
    const status = req.body?.status;
    if (!["novo", "lido", "resolvido"].includes(status)) return res.status(400).json({ error: "Status inválido" });
    const f = await Feedback.findByIdAndUpdate(req.params.id, { $set: { status } }, { returnDocument: "after" }).lean();
    if (!f) return res.status(404).json({ error: "Relato não encontrado" });
    res.json(view(f));
  } catch (error) {
    console.error("feedback.setStatus:", error);
    res.status(500).json({ error: "Erro ao atualizar o relato" });
  }
};

// DELETE /api/admin/feedback/:id
exports.remove = async (req, res) => {
  try {
    const f = await Feedback.findByIdAndDelete(req.params.id);
    if (!f) return res.status(404).json({ error: "Relato não encontrado" });
    res.json({ message: "Relato apagado" });
  } catch (error) {
    console.error("feedback.remove:", error);
    res.status(500).json({ error: "Erro ao apagar o relato" });
  }
};

const Announcement = require("../models/Announcement");

const TYPES = ["info", "update", "maintenance"];
const KEY = { key: "main" };

// Cache curto: TODOS os apps consultam /api/status; sem cache seria 1 consulta
// ao banco por pessoa a cada vez. Admin muda o aviso → o cache é zerado na hora.
const TTL_MS = Number(process.env.ANNOUNCEMENT_CACHE_MS || 15000);
let cached = { at: 0, value: undefined };
const clearCache = () => { cached = { at: 0, value: undefined }; };

const publicView = (a) => (a && a.active && a.message
  ? { type: a.type, message: a.message, updatedAt: a.updatedAt }
  : null);

const adminView = (a) => ({
  active: !!(a && a.active),
  type: a?.type || "info",
  message: a?.message || "",
  updatedAt: a?.updatedAt || null,
});

// GET /api/status  (SEM login — o app consulta até na tela de login)
exports.getPublic = async (_req, res) => {
  try {
    if (cached.value === undefined || Date.now() - cached.at > TTL_MS) {
      const a = await Announcement.findOne(KEY).lean();
      cached = { at: Date.now(), value: publicView(a) };
    }
    res.set("Cache-Control", "no-store");
    res.json({ announcement: cached.value });
  } catch (error) {
    console.error("announcement.getPublic:", error);
    // Falha aqui não pode atrapalhar o app: responde "sem aviso".
    res.json({ announcement: null });
  }
};

// GET /api/admin/announcement
exports.getAdmin = async (_req, res) => {
  try {
    res.json(adminView(await Announcement.findOne(KEY).lean()));
  } catch (error) {
    console.error("announcement.getAdmin:", error);
    res.status(500).json({ error: "Erro ao buscar o aviso" });
  }
};

// PUT /api/admin/announcement   { active, type, message }
exports.set = async (req, res) => {
  try {
    const active  = req.body?.active === true;
    const type    = TYPES.includes(req.body?.type) ? req.body.type : "info";
    const message = String(req.body?.message ?? "").trim();

    if (message.length > 300) return res.status(400).json({ error: "Mensagem muito longa (máx. 300 caracteres)." });
    if (active && message.length < 3) return res.status(400).json({ error: "Escreva a mensagem do aviso." });

    const a = await Announcement.findOneAndUpdate(
      KEY,
      { $set: { active, type, message, updatedAt: new Date() } },
      { upsert: true, returnDocument: "after" }
    ).lean();
    clearCache();
    res.json(adminView(a));
  } catch (error) {
    console.error("announcement.set:", error);
    res.status(500).json({ error: "Erro ao salvar o aviso" });
  }
};

exports._clearCache = clearCache; // usado nos testes

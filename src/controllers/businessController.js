const User = require("../models/User");
const cache = require("../utils/userCache");

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const MAX_SERVICES = 60;

// ─── Ver configuração atual ────────────────────────────────────────
// GET /api/business/config
exports.getConfig = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("businessConfig").lean();
    if (!user) return res.status(404).json({ error: "Usuário não encontrado" });
    res.json(user.businessConfig || {});
  } catch (error) {
    console.error("getConfig:", error);
    res.status(500).json({ error: "Erro ao carregar configuração" });
  }
};

// ─── Atualizar configuração (onboarding e edições depois) ─────────
// PUT /api/business/config
// Body: { businessName, logoUrl, primaryColor, services: [{name, price, active}], locations: ["A","B"], workStart, workEnd }
exports.updateConfig = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: "Usuário não encontrado" });

    const { businessName, logoUrl, primaryColor, services, locations, workStart, workEnd } = req.body || {};
    const bad = (msg) => res.status(400).json({ error: msg });

    if (locations !== undefined) {
      if (!Array.isArray(locations)) return bad("'locations' deve ser uma lista");
      const clean = [...new Set(locations.map((l) => String(l).trim()).filter(Boolean))];
      if (clean.length < 1 || clean.length > 2) return bad("Informe 1 ou 2 locais de atendimento (nomes diferentes)");
      if (clean.some((l) => l.length > 60)) return bad("Nome de local muito longo (máx. 60 caracteres)");
      user.businessConfig.locations = clean;
    }

    if (services !== undefined) {
      if (!Array.isArray(services)) return bad("'services' deve ser uma lista");
      if (services.length > MAX_SERVICES) return bad(`Máximo de ${MAX_SERVICES} serviços`);
      const seen = new Set(); const clean = [];
      for (const s of services) {
        const name = String(s?.name || "").trim();
        if (!name) continue;
        if (name.length > 80) return bad("Nome de serviço muito longo (máx. 80 caracteres)");
        if (name.includes(" + ")) return bad("O nome do serviço não pode conter ' + '");
        const key = name.toLowerCase();
        if (seen.has(key)) continue; // ignora duplicados
        seen.add(key);
        const price = Number(s.price);
        clean.push({ name, price: Number.isFinite(price) && price >= 0 ? price : 0, active: s.active !== false });
      }
      user.businessConfig.services = clean;
    }

    if (businessName !== undefined) {
      const n = String(businessName).trim();
      if (n.length > 80) return bad("Nome do negócio muito longo (máx. 80 caracteres)");
      user.businessConfig.businessName = n;
    }
    if (logoUrl !== undefined) {
      const u = String(logoUrl).trim();
      const isData = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(u);
      if (u && !isData && !/^https?:\/\/\S+$/i.test(u)) return bad("Logo inválida (use uma imagem da galeria ou um link http(s))");
      if (isData ? u.length > 300000 : u.length > 500) return bad("Logo muito grande");
      user.businessConfig.logoUrl = u;
    }
    if (primaryColor !== undefined) {
      if (!HEX_COLOR.test(String(primaryColor))) return bad("Cor inválida (use o formato #RRGGBB)");
      user.businessConfig.primaryColor = String(primaryColor);
    }
    if (workStart !== undefined || workEnd !== undefined) {
      const ws = workStart !== undefined ? Number(workStart) : user.businessConfig.workStart;
      const we = workEnd !== undefined ? Number(workEnd) : user.businessConfig.workEnd;
      if (!Number.isInteger(ws) || !Number.isInteger(we) || ws < 0 || we > 23 || ws >= we) {
        return bad("Horário de funcionamento inválido (início menor que fim, entre 0 e 23)");
      }
      user.businessConfig.workStart = ws;
      user.businessConfig.workEnd = we;
    }

    await user.save();
    cache.invalidate(req.user.id); // checkTrial passa a enxergar os novos locais/horários na hora
    res.json({ message: "Configuração atualizada com sucesso", data: user.businessConfig });
  } catch (error) {
    console.error("updateConfig:", error);
    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((e) => e.message);
      return res.status(400).json({ error: "Dados inválidos", messages });
    }
    res.status(500).json({ error: "Erro ao salvar configuração" });
  }
};

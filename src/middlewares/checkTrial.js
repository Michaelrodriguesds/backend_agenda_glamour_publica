const User = require("../models/User");
const cache = require("../utils/userCache");

// Roda DEPOIS de `protect` (precisa de req.user.id já decodificado do JWT).
// Confere no banco (com cache curto) se o acesso ainda é válido.
// Expirado → 403 { error: "TRIAL_EXPIRED", businessId } pro app mostrar a
// tela de bloqueio com o ID do cliente.
// Exclusão: a logo (base64) não precisa ficar em cache nem trafegar a cada request.
const SELECT = "-passwordHash -resetCodeHash -resetCodeExpires -resetAttempts -businessConfig.logoUrl -__v";

const checkTrial = async (req, res, next) => {
  try {
    const id = req.user.id;
    let user = cache.get(id);
    if (!user) {
      user = await User.findById(id).select(SELECT).lean();
      if (!user) return res.status(401).json({ error: "Usuário não encontrado" });
      cache.set(id, user);
    }

    const expiry = User.accessExpiry(user);
    if (expiry <= Date.now()) {
      // mantém o campo planStatus gravado coerente (só escreve se mudou)
      if (user.planStatus !== "blocked") {
        user.planStatus = "blocked";
        User.updateOne({ _id: id }, { planStatus: "blocked" }).catch(() => {});
      }
      return res.status(403).json({
        error: "TRIAL_EXPIRED",
        message: "Seu período gratuito expirou. Entre em contato informando seu ID para liberar mais 30 dias.",
        businessId: user.businessId,
        expiredAt: new Date(expiry),
      });
    }

    req.currentUser = user;
    next();
  } catch (error) {
    console.error("checkTrial:", error);
    res.status(500).json({ error: "Erro interno do servidor" });
  }
};

module.exports = checkTrial;

const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { sendResetCodeEmail } = require("../utils/email");

const MAX_PASSWORD = 128; // evita hash de senhas gigantes (DoS) e o limite de 72 bytes do bcrypt
const MAX_RESET_ATTEMPTS = 5;
const EMAIL_RX = /^\S+@\S+\.\S+$/;

const normEmail = (e) => String(e || "").toLowerCase().trim();

const signToken = (user) => {
  const expiresIn = process.env.JWT_EXPIRES_IN || "30d";
  return jwt.sign(
    { id: user._id.toString(), businessId: user.businessId, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn }
  );
};

// Resposta de usuário: o status do plano é sempre calculado na hora
const publicUser = (user) => {
  const obj = user.toJSON ? user.toJSON() : user;
  obj.planStatus = User.effectiveStatus(user);
  return obj;
};

// ─── Cadastro ────────────────────────────────────────────────────
// POST /api/auth/register
// Body: { email, password, businessName, locations: [1 ou 2 nomes] }
exports.register = async (req, res) => {
  try {
    const { password, businessName, locations } = req.body || {};
    const email = normEmail(req.body?.email);

    if (!email || !password) {
      return res.status(400).json({ error: "E-mail e senha são obrigatórios" });
    }
    if (!EMAIL_RX.test(email) || email.length > 254) {
      return res.status(400).json({ error: "E-mail inválido" });
    }
    if (typeof password !== "string" || password.length < 6) {
      return res.status(400).json({ error: "Senha deve ter no mínimo 6 caracteres" });
    }
    if (password.length > MAX_PASSWORD) {
      return res.status(400).json({ error: `Senha muito longa (máx. ${MAX_PASSWORD} caracteres)` });
    }

    const locs = Array.isArray(locations)
      ? [...new Set(locations.map((l) => String(l).trim()).filter(Boolean))].slice(0, 2)
      : [];

    const user = new User({
      email,
      businessConfig: {
        businessName: String(businessName || "").trim().slice(0, 80),
        // Se não vier nada agora, o onboarding do app completa depois.
        locations: locs.length > 0 ? locs : ["Local principal"],
      },
    });
    await user.setPassword(password);

    // businessId é aleatório; no caso raríssimo de colisão, tenta outro
    for (let attempt = 0; ; attempt++) {
      try {
        await user.save();
        break;
      } catch (err) {
        if (err.code === 11000 && err.keyPattern?.businessId && attempt < 5) {
          user.businessId = User.generateBusinessId();
          continue;
        }
        throw err;
      }
    }

    res.status(201).json({
      message: "Conta criada com sucesso. Você tem 30 dias grátis.",
      token: signToken(user),
      user: publicUser(user),
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ error: "Já existe uma conta com este e-mail" });
    }
    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((e) => e.message);
      return res.status(400).json({ error: "Dados inválidos", messages });
    }
    console.error("register:", error);
    res.status(500).json({ error: "Erro ao criar conta" });
  }
};

// ─── Login ───────────────────────────────────────────────────────
// POST /api/auth/login  Body: { email, password }
exports.login = async (req, res) => {
  try {
    const email = normEmail(req.body?.email);
    const password = req.body?.password;
    if (!email || !password || typeof password !== "string") {
      return res.status(400).json({ error: "E-mail e senha são obrigatórios" });
    }
    if (password.length > MAX_PASSWORD) {
      return res.status(401).json({ error: "E-mail ou senha inválidos" });
    }

    const user = await User.findOne({ email });
    if (!user || !(await user.checkPassword(password))) {
      return res.status(401).json({ error: "E-mail ou senha inválidos" });
    }

    res.json({ message: "Login realizado com sucesso", token: signToken(user), user: publicUser(user) });
  } catch (error) {
    console.error("login:", error);
    res.status(500).json({ error: "Erro ao fazer login" });
  }
};

// ─── Verificar token ─────────────────────────────────────────────
exports.verifyToken = (req, res) => {
  res.json({ valid: true, user: req.user });
};

// ─── Perfil do usuário logado ─────────────────────────────────────
// GET /api/auth/me  (funciona mesmo bloqueado: mostra o ID e o status)
exports.getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(401).json({ error: "Usuário não encontrado" });
    res.json(publicUser(user));
  } catch (error) {
    res.status(500).json({ error: "Erro ao carregar perfil" });
  }
};

// ─── Refresh token silencioso ─────────────────────────────────────
// POST /api/auth/refresh — aceita token vencido (só confere a assinatura),
// mas exige que o usuário ainda exista e que seja um token da versão nova.
exports.refreshToken = async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Token não fornecido" });
    }

    let decoded;
    try {
      decoded = jwt.verify(authHeader.split(" ")[1], process.env.JWT_SECRET, { ignoreExpiration: true });
    } catch (err) {
      return res.status(401).json({ error: "Token inválido" });
    }
    if (!decoded.id) return res.status(401).json({ error: "Sessão antiga. Faça login novamente." });

    const user = await User.findById(decoded.id).select("businessId email");
    if (!user) return res.status(401).json({ error: "Usuário não encontrado" });

    res.json({ token: signToken(user), expiresIn: process.env.JWT_EXPIRES_IN || "30d" });
  } catch (error) {
    console.error("refreshToken:", error);
    res.status(500).json({ error: "Erro ao renovar sessão" });
  }
};

// ─── Esqueci minha senha: envia código por e-mail ─────────────────
// POST /api/auth/forgot-password  Body: { email }
// Responde igual exista ou não o e-mail, e SEM esperar o envio do e-mail
// (senão o tempo de resposta revelaria quais e-mails têm conta).
exports.forgotPassword = async (req, res) => {
  const generic = { message: "Se este e-mail existir, um código foi enviado." };
  try {
    const email = normEmail(req.body?.email);
    if (!email) return res.status(400).json({ error: "E-mail é obrigatório" });

    const user = await User.findOne({ email });
    if (!user) return res.json(generic);

    const code = await user.generateResetCode();
    await user.save();
    res.json(generic);

    sendResetCodeEmail(user.email, code).catch((err) =>
      console.error("forgotPassword: falha ao enviar e-mail:", err.message)
    );
  } catch (error) {
    console.error("forgotPassword:", error);
    if (!res.headersSent) res.status(500).json({ error: "Erro ao solicitar código" });
  }
};

// ─── Redefinir senha com o código recebido ────────────────────────
// POST /api/auth/reset-password  Body: { email, code, newPassword }
// O código (6 dígitos) é invalidado após 5 tentativas erradas — sem isso
// dava pra adivinhar o código por força bruta nos 15 minutos de validade.
exports.resetPassword = async (req, res) => {
  try {
    const email = normEmail(req.body?.email);
    const { code, newPassword } = req.body || {};
    if (!email || !code || !newPassword) {
      return res.status(400).json({ error: "E-mail, código e nova senha são obrigatórios" });
    }
    if (typeof newPassword !== "string" || newPassword.length < 6) {
      return res.status(400).json({ error: "Senha deve ter no mínimo 6 caracteres" });
    }
    if (newPassword.length > MAX_PASSWORD) {
      return res.status(400).json({ error: `Senha muito longa (máx. ${MAX_PASSWORD} caracteres)` });
    }

    const invalid = () => res.status(400).json({ error: "Código inválido ou expirado" });

    const user = await User.findOne({ email });
    if (!user || !user.resetCodeHash) return invalid();

    if (user.resetAttempts >= MAX_RESET_ATTEMPTS) {
      user.resetCodeHash = null; user.resetCodeExpires = null; user.resetAttempts = 0;
      await user.save();
      return invalid();
    }

    if (!(await user.checkResetCode(String(code).trim()))) {
      user.resetAttempts += 1;
      if (user.resetAttempts >= MAX_RESET_ATTEMPTS) { user.resetCodeHash = null; user.resetCodeExpires = null; user.resetAttempts = 0; }
      await user.save();
      return invalid();
    }

    await user.setPassword(newPassword);
    user.resetCodeHash = null;
    user.resetCodeExpires = null;
    user.resetAttempts = 0;
    await user.save();

    res.json({ message: "Senha redefinida com sucesso. Faça login novamente." });
  } catch (error) {
    console.error("resetPassword:", error);
    res.status(500).json({ error: "Erro ao redefinir senha" });
  }
};

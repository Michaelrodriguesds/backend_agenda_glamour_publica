const mongoose = require("mongoose");
// bcrypt nativo roda fora da thread principal (não trava o servidor em picos de
// login) e é ~3x mais rápido. Se o binário nativo não estiver disponível no
// ambiente de deploy, cai automaticamente para o bcryptjs (100% compatível).
let bcrypt;
try { bcrypt = require("bcrypt"); } catch (_) { bcrypt = require("bcryptjs"); }
const crypto = require("crypto");

const generateBusinessId = () => crypto.randomBytes(4).toString("hex").toUpperCase(); // ex: "A3F9C1B2"

// ── Sub-schema: configuração visual/operacional do negócio ───────
// Isso é o que cada usuário personaliza: logo, serviços, locais.
const serviceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    price: { type: Number, default: 0, min: 0 },
    active: { type: Boolean, default: true },
    // Aba "Clientes & Marketing": depois de quantos dias a cliente deve
    // refazer este serviço. 0 = não gera lembrete de retorno.
    returnDays: { type: Number, default: 0, min: 0, max: 365 },
  },
  { _id: false }
);

const businessConfigSchema = new mongoose.Schema(
  {
    businessName: { type: String, trim: true, default: "" },
    ownerName: { type: String, trim: true, default: "" }, // nome do dono, para a saudação do app
    logoUrl: { type: String, default: "" }, // URL da logo enviada (ex: Cloudinary) ou nome de um preset
    primaryColor: { type: String, default: "#B47FD4" },
    services: { type: [serviceSchema], default: [] },
    // 1 ou 2 locais, nome livre — cada usuário define os seus
    locations: {
      type: [String],
      default: [],
      validate: {
        validator: (arr) => arr.length >= 1 && arr.length <= 2,
        message: "Deve haver 1 ou 2 locais de atendimento",
      },
    },
    workStart: { type: Number, default: 7 },
    workEnd: { type: Number, default: 21 },
  },
  { _id: false }
);

// ── Schema principal: User = um negócio/tenant ────────────────────
const userSchema = new mongoose.Schema(
  {
    // businessId curto e legível — é o que o cliente te informa por
    // WhatsApp/e-mail pra você localizar e liberar o acesso dele.
    businessId: {
      type: String,
      unique: true, // já cria o índice
      default: generateBusinessId,
    },

    email: {
      type: String,
      required: [true, "E-mail é obrigatório"],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, "E-mail inválido"],
    },
    passwordHash: {
      type: String,
      required: true,
    },

    // ── Controle de plano / trial / bloqueio manual ─────────────
    // trial -> dentro do mês grátis
    // active -> liberado manualmente por você (unlockedUntil no futuro)
    // blocked -> expirou e ainda não foi liberado
    planStatus: {
      type: String,
      enum: ["trial", "active", "blocked"],
      default: "trial",
    },
    trialEndsAt: {
      type: Date,
      default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // +30 dias
    },
    // Toda vez que você libera manualmente, isso avança +30 dias
    unlockedUntil: {
      type: Date,
      default: null,
    },

    // ── Recuperação de senha ─────────────────────────────────────
    resetCodeHash: { type: String, default: null },
    resetCodeExpires: { type: Date, default: null },
    resetAttempts: { type: Number, default: 0 }, // tentativas erradas do código atual

    businessConfig: {
      type: businessConfigSchema,
      default: () => ({}),
    },
  },
  { timestamps: true }
);

userSchema.index({ planStatus: 1 });

// ── Senha ───────────────────────────────────────────────────────
userSchema.methods.setPassword = async function (plainPassword) {
  this.passwordHash = await bcrypt.hash(plainPassword, 10);
};

userSchema.methods.checkPassword = function (plainPassword) {
  return bcrypt.compare(plainPassword, this.passwordHash);
};

// ── Código de recuperação (6 dígitos, expira em 15 min) ──────────
userSchema.methods.generateResetCode = async function () {
  const code = String(crypto.randomInt(100000, 1000000)); // 6 dígitos, aleatoriedade criptográfica
  this.resetCodeHash = await bcrypt.hash(code, 10);
  this.resetCodeExpires = new Date(Date.now() + 15 * 60 * 1000);
  this.resetAttempts = 0;
  return code; // texto puro — só existe nesse momento, pra ir no e-mail
};

userSchema.methods.checkResetCode = function (code) {
  if (!this.resetCodeHash || !this.resetCodeExpires) return false;
  if (this.resetCodeExpires < new Date()) return false;
  return bcrypt.compare(code, this.resetCodeHash);
};

// ── Data efetiva de expiração de acesso (a mais distante entre
// o fim do trial e a última liberação manual) ─────────────────────
userSchema.methods.getAccessExpiry = function () {
  const trial = this.trialEndsAt ? this.trialEndsAt.getTime() : 0;
  const unlocked = this.unlockedUntil ? this.unlockedUntil.getTime() : 0;
  return new Date(Math.max(trial, unlocked));
};

userSchema.methods.hasActiveAccess = function () {
  return this.getAccessExpiry().getTime() > Date.now();
};

// Status "de verdade" calculado na hora (não depende do campo gravado,
// que só é atualizado quando o usuário faz alguma requisição).
userSchema.methods.getEffectiveStatus = function () {
  return effectiveStatus(this);
};

// Funções puras usadas também com documentos "lean" (sem métodos do Mongoose)
function accessExpiry(u) {
  const trial = u.trialEndsAt ? new Date(u.trialEndsAt).getTime() : 0;
  const unlocked = u.unlockedUntil ? new Date(u.unlockedUntil).getTime() : 0;
  return Math.max(trial, unlocked);
}
function effectiveStatus(u) {
  const now = Date.now();
  if (accessExpiry(u) <= now) return "blocked";
  if (u.unlockedUntil && new Date(u.unlockedUntil).getTime() > now) return "active";
  return "trial";
}

// ── Nunca expõe hash de senha/código no JSON ──────────────────────
userSchema.set("toJSON", {
  transform: (_doc, ret) => {
    delete ret.passwordHash;
    delete ret.resetCodeHash;
    delete ret.resetCodeExpires;
    delete ret.resetAttempts;
    delete ret.__v;
    return ret;
  },
});

const User = mongoose.model("User", userSchema);
User.generateBusinessId = generateBusinessId;
User.accessExpiry = accessExpiry;
User.effectiveStatus = effectiveStatus;
module.exports = User;

const mongoose = require("mongoose");

// ── Constantes de domínio ────────────────────────────────────────
const PROCEDURES = [
  "Cílios Tufinho",          // ← "Cílios" simples removido, "Designer Completo" removido
  "Sobrancelha com Henna",
  "Sobrancelha sem Henna",
  "Spa dos Lábios",
  "Depilação",
  "Limpeza de Pele",         // ← NOVO
];

const LOCATIONS   = ["Studio Manilha", "Studio Guaxindiba"];
const PAY_METHODS = ["PIX", "Cartão", "Dinheiro", "A combinar", ""];

// ── Schema ───────────────────────────────────────────────────────
const appointmentSchema = new mongoose.Schema(
  {
    // Dono do agendamento (tenant) — toda query do controller filtra por isso
    userId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      "User",
      required: true,
      index:    true,
    },

    clientName: {
      type:     String,
      required: [true, "Nome da cliente é obrigatório"],
      trim:     true,
    },

    // Array de procedimentos selecionados
    // Sem enum → retrocompatível com nomes legados no banco
    procedures: {
      type:    [String],
      default: [],
    },

    // Campo string calculado pelo pre-save hook a partir de `procedures`
    // Ex: "Cílios Tufinho + Sobrancelha com Henna"
    procedure: {
      type:  String,
    },

    date: {
      type:     Date,
      required: [true, "Data é obrigatória"],
    },
    time: {
      type:     String,
      required: [true, "Horário é obrigatório"],
      match:    [/^([01]\d|2[0-3]):[0-5]\d$/, "Horário inválido (use HH:MM entre 00:00 e 23:59)"],
    },
    // Locais agora são definidos por usuário (User.businessConfig.locations),
    // não é mais uma lista fixa — validado no controller contra a config do tenant.
    location: {
      type:     String,
      required: [true, "Local é obrigatório"],
      trim:     true,
    },

    price: {
      type:     Number,
      required: [true, "Valor é obrigatório"],
      min:      [0, "Valor não pode ser negativo"],
    },
    paymentMethod: {
      type:    String,
      enum:    { values: PAY_METHODS, message: "Forma de pagamento inválida" },
      default: "",
    },
    paid: {
      type:    Boolean,
      default: false,
    },
    paidAt: {
      type:    Date,
      default: null,
    },
    confirmed: {
      type:    Boolean,
      default: false,
    },
    confirmedAt: {
      type:    Date,
      default: null,
    },
    notes: {
      type:      String,
      default:   "",
      trim:      true,
      maxlength: [500, "Observação muito longa (máx. 500 caracteres)"],
    },
  },
  { timestamps: true }
);

// ── Índices ───────────────────────────────────────────────────────
// Toda consulta do app filtra por userId primeiro, então todos os índices
// começam por ele. (Antes: 7 índices independentes que o Mongo quase nunca
// usava em conjunto com userId — só deixavam as escritas mais lentas.)
appointmentSchema.index({ userId: 1, date: 1, time: 1 });       // lista do dia/mês + ocupação de slot
appointmentSchema.index({ userId: 1, date: 1, location: 1 });   // filtro por local
appointmentSchema.index({ userId: 1, clientName: 1 });          // busca por cliente
appointmentSchema.index({ userId: 1, paid: 1, date: 1 });       // pendências de pagamento

// ── Pre-save: sincroniza `procedure` (string) com `procedures` (array)
appointmentSchema.pre("save", async function () {
  if (Array.isArray(this.procedures) && this.procedures.length > 0) {
    this.procedure = this.procedures.join(" + ");
  } else if (this.procedure && (!this.procedures || this.procedures.length === 0)) {
    this.procedures = this.procedure.split(" + ").map((s) => s.trim()).filter(Boolean);
  }
});

// findByIdAndUpdate não dispara 'save' → hook dedicado
appointmentSchema.pre("findOneAndUpdate", async function () {
  const update = this.getUpdate();
  const procs  = update?.$set?.procedures ?? update?.procedures;

  if (Array.isArray(procs) && procs.length > 0) {
    const joined = procs.join(" + ");
    if (update.$set) {
      update.$set.procedure = joined;
    } else {
      update.procedure = joined;
    }
  } else {
    const procStr = update?.$set?.procedure ?? update?.procedure;
    if (procStr && typeof procStr === "string") {
      const arr = procStr.split(" + ").map((s) => s.trim()).filter(Boolean);
      if (update.$set) {
        update.$set.procedures = arr;
      } else {
        update.procedures = arr;
      }
    }
  }
});

// ── Virtuals ──────────────────────────────────────────────────────
appointmentSchema.virtual("formattedDate").get(function () {
  return this.date
    ? this.date.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })
    : null;
});

appointmentSchema.virtual("datetime").get(function () {
  if (!this.date || !this.time) return null;
  const [h, m] = this.time.split(":");
  const d = new Date(this.date);
  d.setHours(parseInt(h), parseInt(m), 0, 0);
  return d;
});

// ── Métodos ───────────────────────────────────────────────────────
appointmentSchema.methods.markAsPaid = function (method) {
  this.paid   = true;
  this.paidAt = new Date();
  if (method) this.paymentMethod = method;
  return this.save();
};

appointmentSchema.methods.confirm = function () {
  this.confirmed   = true;
  this.confirmedAt = new Date();
  return this.save();
};

appointmentSchema.set("toJSON",   { virtuals: true });
appointmentSchema.set("toObject", { virtuals: true });

// ── Exporta modelo + constantes ───────────────────────────────────
const AppointmentModel      = mongoose.model("Appointment", appointmentSchema);
AppointmentModel.PROCEDURES = PROCEDURES;
AppointmentModel.LOCATIONS  = LOCATIONS;
AppointmentModel.PAY_METHODS = PAY_METHODS;

module.exports = AppointmentModel;
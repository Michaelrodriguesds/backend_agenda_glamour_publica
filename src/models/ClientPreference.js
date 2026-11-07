const mongoose = require("mongoose");

// Preferências de lembrete por cliente (aba "Clientes & Marketing").
// Sem registro para a cliente = recebe os dois lembretes (padrão).
// O dono do negócio desmarca na ficha da cliente, na aba Clientes.
//
// Multi-negócio: a mesma "Maria" pode existir em dois negócios diferentes,
// por isso o nome é único SÓ dentro do mesmo negócio (userId + clientName).
const clientPreferenceSchema = new mongoose.Schema(
  {
    userId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      "User",
      required: true,
    },
    clientName: {
      type:      String,
      required:  [true, "Nome da cliente é obrigatório"],
      trim:      true,
      maxlength: 120,
    },
    remindAppointment: { type: Boolean, default: true }, // lembrete do agendamento
    remindReturn:      { type: Boolean, default: true }, // lembrete de "hora de refazer"
  },
  { timestamps: true }
);

clientPreferenceSchema.index({ userId: 1, clientName: 1 }, { unique: true });

module.exports = mongoose.model("ClientPreference", clientPreferenceSchema);

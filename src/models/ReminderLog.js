const mongoose = require("mongoose");

// Registro de "Enviei" da aba "Clientes & Marketing".
// Serve só para riscar a cliente da lista e não mostrar de novo.
// Apaga sozinho depois de 120 dias (índice TTL), para não crescer à toa.
//
// Multi-negócio: a chave é única SÓ dentro do mesmo negócio (userId + key).
const reminderLogSchema = new mongoose.Schema({
  userId: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      "User",
    required: true,
  },
  key: {
    type:      String,
    required:  true,
    maxlength: 300,
  },
  type: {
    type:     String,
    enum:     ["appointment", "return", "campaign"],
    required: true,
  },
  clientName: { type: String, trim: true, default: "" },
  sentAt: {
    type:    Date,
    default: Date.now,
    expires: 60 * 60 * 24 * 120, // 120 dias
  },
});

reminderLogSchema.index({ userId: 1, key: 1 }, { unique: true });

module.exports = mongoose.model("ReminderLog", reminderLogSchema);

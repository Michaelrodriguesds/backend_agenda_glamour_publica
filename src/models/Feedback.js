const mongoose = require("mongoose");

// Relato enviado pelo usuário dentro do app (erro, melhoria ou outro).
// Só o admin (você) lê, pelo painel /admin.
const feedbackSchema = new mongoose.Schema({
  userId:       { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  businessId:   { type: String, default: "" },   // ID curto do cliente (o mesmo do bloqueio)
  email:        { type: String, default: "" },
  businessName: { type: String, default: "" },
  type:         { type: String, enum: ["bug", "melhoria", "outro"], default: "outro" },
  message:      { type: String, required: true, trim: true, minlength: 5, maxlength: 1000 },
  appVersion:   { type: String, default: "", maxlength: 30 },
  status:       { type: String, enum: ["novo", "lido", "resolvido"], default: "novo" },
  createdAt:    { type: Date, default: Date.now },
});

feedbackSchema.index({ status: 1, createdAt: -1 });
feedbackSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model("Feedback", feedbackSchema);

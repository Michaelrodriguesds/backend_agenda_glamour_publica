const mongoose = require("mongoose");

// Aviso global (manutenção / atualização) que o admin liga e desliga.
// Existe UM só documento (key = "main"). O app consulta /api/status e mostra
// uma faixa no topo para todos os usuários.
const announcementSchema = new mongoose.Schema({
  key:       { type: String, default: "main", unique: true },
  active:    { type: Boolean, default: false },
  type:      { type: String, enum: ["info", "update", "maintenance"], default: "info" },
  message:   { type: String, default: "", maxlength: 300 },
  updatedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Announcement", announcementSchema);

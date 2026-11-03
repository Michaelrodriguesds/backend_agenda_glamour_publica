const mongoose = require("mongoose");

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI, {
      maxPoolSize:              10,     // Atlas M0 aceita até 500 conexões
      minPoolSize:              1,
      serverSelectionTimeoutMS: 8000,   // Atlas free pode demorar a "acordar"
      socketTimeoutMS:          45000,
    });
    console.log(`✅ MongoDB conectado: ${conn.connection.host}`);

    mongoose.connection.on("disconnected", () => console.warn("⚠️  MongoDB desconectado"));
    mongoose.connection.on("reconnected", () => console.log("✅ MongoDB reconectado"));
    mongoose.connection.on("error", (err) => console.error("❌ Erro MongoDB:", err.message));

    // Garante os índices novos (userId + ...) e remove os antigos que não
    // existem mais no schema. Roda em segundo plano para não atrasar o start.
    syncIndexes().catch((e) => console.warn("⚠️  syncIndexes:", e.message));
  } catch (error) {
    console.error("❌ Falha ao conectar MongoDB:", error.message);
    process.exit(1);
  }
};

async function syncIndexes() {
  const models = ["User", "Appointment", "Note"].map((n) => mongoose.model(n));
  for (const m of models) await m.syncIndexes();
  console.log("✅ Índices sincronizados");
}

module.exports = connectDB;

// Migra dados da versão ANTIGA (sem multi-negócio) para uma conta nova.
// Agendamentos e notas antigos não têm "userId" — sem isso ninguém os enxerga.
//
// Uso (na pasta do backend, com o .env apontando para o MESMO banco):
//   node scripts/migrate-legacy.js dono@email.com            # só mostra o que faria
//   node scripts/migrate-legacy.js dono@email.com --apply    # grava de verdade
//
// Antes: crie a conta do dono pelo app (cadastro normal) e faça o onboarding.
require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../src/models/User");
const Appointment = require("../src/models/Appointment");
const Note = require("../src/models/Note");

(async () => {
  const email = (process.argv[2] || "").trim().toLowerCase();
  const apply = process.argv.includes("--apply");
  if (!email || email.startsWith("--")) {
    console.error("Informe o e-mail da conta que vai receber os dados antigos.");
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGO_URI);
  const user = await User.findOne({ email });
  if (!user) { console.error("Conta não encontrada: " + email); process.exit(1); }

  const filter = { $or: [{ userId: { $exists: false } }, { userId: null }] };
  const nApt = await Appointment.collection.countDocuments(filter);
  const nNote = await Note.collection.countDocuments(filter);
  console.log(`Conta: ${email} (ID ${user.businessId})`);
  console.log(`Agendamentos sem dono: ${nApt} | Notas sem dono: ${nNote}`);

  if (!apply) {
    console.log("\nSimulação. Rode de novo com --apply para gravar.");
  } else {
    // collection.* evita validações/enum antigos do schema ao regravar documentos antigos
    const a = await Appointment.collection.updateMany(filter, { $set: { userId: user._id } });
    const n = await Note.collection.updateMany(filter, { $set: { userId: user._id } });
    console.log(`\nFeito: ${a.modifiedCount} agendamentos e ${n.modifiedCount} notas agora pertencem a ${email}.`);
    console.log("Confira se os nomes dos locais antigos existem nos locais da conta (Configurações do app).");
  }
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });

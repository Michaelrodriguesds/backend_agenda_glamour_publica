const mongoose    = require("mongoose");
const Appointment = require("../models/Appointment");

// aggregate() NÃO converte texto em ObjectId (o find() converte sozinho).
const oid = (id) => new mongoose.Types.ObjectId(String(id));
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ────────────────────────────────────────────────────────────────
// LISTAR CLIENTES DO NEGÓCIO (calculado no banco)
// GET /api/clients?search=maria
//
// Antes, a tela Clientes baixava TODOS os agendamentos (até 5000
// documentos inteiros) só para somar e contar no celular. Aqui o MongoDB
// agrupa e devolve UMA linha por cliente — bem menos dados no 4G e o
// resultado nunca fica cortado pelo limite de segurança da listagem.
// ────────────────────────────────────────────────────────────────
exports.getClients = async (req, res) => {
  try {
    const match = { userId: oid(req.user.id) }; // só as clientes deste negócio
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    if (search) match.clientName = { $regex: esc(search.slice(0, 120)), $options: "i" };

    const clients = await Appointment.aggregate([
      { $match: match },
      {
        $group: {
          _id:              "$clientName",
          count:            { $sum: 1 },
          totalRevenue:     { $sum: { $ifNull: ["$price", 0] } },
          receivedRevenue:  { $sum: { $cond: ["$paid", { $ifNull: ["$price", 0] }, 0] } },
          pendingCount:     { $sum: { $cond: ["$paid", 0, 1] } },
          unconfirmedCount: { $sum: { $cond: ["$confirmed", 0, 1] } },
          lastAppointment:  { $max: "$date" },
        },
      },
      { $sort: { count: -1, _id: 1 } },
    ]);

    const r2 = (n) => Math.round((n || 0) * 100) / 100;
    res.json({
      count: clients.length,
      data: clients.map((c) => ({
        clientName:       c._id || "(sem nome)",
        count:            c.count,
        totalRevenue:     r2(c.totalRevenue),
        receivedRevenue:  r2(c.receivedRevenue),
        pendingRevenue:   r2(c.totalRevenue - c.receivedRevenue),
        pendingCount:     c.pendingCount,
        unconfirmedCount: c.unconfirmedCount,
        lastAppointment:  c.lastAppointment,
      })),
    });
  } catch (error) {
    console.error("clientController.getClients:", error);
    res.status(500).json({ error: "Erro ao listar clientes" });
  }
};

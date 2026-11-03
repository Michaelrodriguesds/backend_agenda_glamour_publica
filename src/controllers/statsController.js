const mongoose = require("mongoose");
const Appointment = require("../models/Appointment");

// IMPORTANTE: aggregate() NÃO converte string em ObjectId (find() converte).
// Sem isto o $match por userId não achava nada e as estatísticas vinham zeradas.
const oid = (id) => new mongoose.Types.ObjectId(String(id));

// ────────────────────────────────────────────────────────────────
// ESTATÍSTICAS MENSAIS COMPLETAS
// GET /api/stats/monthly?month=3&year=2025
// ────────────────────────────────────────────────────────────────
exports.getMonthlyStats = async (req, res) => {
  try {
    const { month, year } = req.query;
    if (!month || !year) {
      return res.status(400).json({ error: "Parâmetros 'month' e 'year' são obrigatórios" });
    }

    const m = parseInt(month);
    const y = parseInt(year);

    const firstDay = new Date(Date.UTC(y, m - 1, 1,  0,  0,  0,   0));
    const lastDay  = new Date(Date.UTC(y, m,     0, 23, 59, 59, 999));
    const match    = { userId: oid(req.user.id), date: { $gte: firstDay, $lte: lastDay } };

    const [
      revenueData,
      procedureStats,
      locationStats,
      payMethodStats,
      clientStats,
      pendingPayments,
      unconfirmed,
      totalCount,
    ] = await Promise.all([

      Appointment.aggregate([
        { $match: match },
        {
          $group: {
            _id:             null,
            totalRevenue:    { $sum: "$price" },
            receivedRevenue: { $sum: { $cond: ["$paid", "$price", 0] } },
            pendingRevenue:  { $sum: { $cond: ["$paid", 0, "$price"] } },
          },
        },
      ]),

      Appointment.aggregate([
        { $match: match },
        {
          $addFields: {
            proceduresList: {
              $cond: {
                if:   { $and: [{ $isArray: "$procedures" }, { $gt: [{ $size: "$procedures" }, 0] }] },
                then: "$procedures",
                else: {
                  $cond: {
                    if:   { $and: [{ $ne: ["$procedure", null] }, { $ne: ["$procedure", ""] }] },
                    then: [{ $ifNull: ["$procedure", "Sem procedimento"] }],
                    else: [],
                  },
                },
              },
            },
            numProcs: {
              $cond: {
                if:   { $and: [{ $isArray: "$procedures" }, { $gt: [{ $size: "$procedures" }, 0] }] },
                then: { $size: "$procedures" },
                else: 1,
              },
            },
          },
        },
        { $unwind: "$proceduresList" },
        {
          $group: {
            _id:     "$proceduresList",
            count:   { $sum: 1 },
            revenue: { $sum: { $divide: ["$price", "$numProcs"] } },
          },
        },
        { $sort: { count: -1 } },
      ]),

      Appointment.aggregate([
        { $match: match },
        { $group: { _id: "$location", count: { $sum: 1 }, revenue: { $sum: "$price" } } },
        { $sort: { count: -1 } },
      ]),

      Appointment.aggregate([
        { $match: { ...match, paid: true } },
        { $group: { _id: "$paymentMethod", count: { $sum: 1 }, total: { $sum: "$price" } } },
        { $sort: { count: -1 } },
      ]),

      Appointment.aggregate([
        { $match: match },
        {
          $group: {
            _id:     "$clientName",
            count:   { $sum: 1 },
            revenue: { $sum: "$price" },
            paid:    { $sum: { $cond: ["$paid", "$price", 0] } },
          },
        },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]),

      Appointment.find({ ...match, paid: false })
        .select("clientName procedure procedures date time location price")
        .sort({ date: 1 })
        .lean(),

      Appointment.find({ ...match, confirmed: false })
        .select("clientName procedure procedures date time location")
        .sort({ date: 1 })
        .lean(),

      Appointment.countDocuments(match),
    ]);

    const maxProc           = procedureStats[0]?.count || 1;
    const proceduresWithPct = procedureStats.map((p) => ({
      procedure:    p._id || "Sem procedimento",
      count:        p.count,
      revenue:      Math.round(p.revenue * 100) / 100,
      percentage:   Math.round((p.count / maxProc) * 100),
      shareOfTotal: Math.round((p.count / (totalCount || 1)) * 100),
    }));

    const totalApts        = locationStats.reduce((s, l) => s + l.count, 0) || 1;
    const locationsWithPct = locationStats.map((l) => ({
      location:   l._id || "Sem local",
      count:      l.count,
      revenue:    l.revenue,
      percentage: Math.round((l.count / totalApts) * 100),
    }));

    const totalPaidApts     = payMethodStats.reduce((s, m) => s + m.count, 0) || 1;
    const payMethodsWithPct = payMethodStats.map((m) => ({
      method:     m._id || "Não informado",
      count:      m.count,
      total:      m.total,
      percentage: Math.round((m.count / totalPaidApts) * 100),
    }));

    const rev      = revenueData[0] || { totalRevenue: 0, receivedRevenue: 0, pendingRevenue: 0 };
    const totalRev = rev.totalRevenue || 0;
    const recvRev  = rev.receivedRevenue || 0;

    res.json({
      period: { month: m, year: y },
      summary: {
        totalAppointments:       totalCount,
        paidAppointments:        totalCount - pendingPayments.length,
        unpaidAppointments:      pendingPayments.length,
        confirmedAppointments:   totalCount - unconfirmed.length,
        unconfirmedAppointments: unconfirmed.length,
      },
      revenue: {
        total:              totalRev,
        received:           recvRev,
        pending:            rev.pendingRevenue || 0,
        receivedPercentage: totalRev > 0 ? Math.round((recvRev / totalRev) * 100) : 0,
      },
      procedures:     proceduresWithPct,
      locations:      locationsWithPct,
      paymentMethods: payMethodsWithPct,
      topClients:     clientStats,
      pendingPayments,
      unconfirmed,
    });
  } catch (error) {
    console.error("statsController.getMonthlyStats:", error);
    res.status(500).json({ error: "Erro ao calcular estatísticas" });
  }
};

// ────────────────────────────────────────────────────────────────
// TENDÊNCIA ANUAL — todos os meses até o mês atual
// GET /api/stats/trend?year=2025
//
// ✅ NOVO: retorna resumo mês a mês para o gráfico de fluxo anual.
//   Permite identificar picos e baixas de demanda ao longo do ano.
// ────────────────────────────────────────────────────────────────
exports.getTrendStats = async (req, res) => {
  try {
    const { year } = req.query;
    if (!year) {
      return res.status(400).json({ error: "Parâmetro 'year' é obrigatório" });
    }

    const y           = parseInt(year);
    const now         = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    // Se for o ano atual, vai até o mês atual; senão, todos os 12 meses
    const maxMonth = y === currentYear ? currentMonth : 12;

    const monthsData = await Promise.all(
      Array.from({ length: maxMonth }, async (_, i) => {
        const m        = i + 1;
        const firstDay = new Date(Date.UTC(y, m - 1, 1,  0,  0,  0,   0));
        const lastDay  = new Date(Date.UTC(y, m,     0, 23, 59, 59, 999));
        const match    = { userId: oid(req.user.id), date: { $gte: firstDay, $lte: lastDay } };

        const [countResult, revenueResult, topProcResult] = await Promise.all([
          Appointment.countDocuments(match),

          Appointment.aggregate([
            { $match: match },
            { $group: { _id: null, total: { $sum: "$price" }, received: { $sum: { $cond: ["$paid", "$price", 0] } } } },
          ]),

          // Procedimento mais realizado no mês
          Appointment.aggregate([
            { $match: match },
            { $unwind: { path: "$procedures", preserveNullAndEmptyArrays: true } },
            {
              $group: {
                _id:   { $ifNull: ["$procedures", "$procedure"] },
                count: { $sum: 1 },
              },
            },
            { $sort: { count: -1 } },
            { $limit: 1 },
          ]),
        ]);

        return {
          month:             m,
          year:              y,
          totalAppointments: countResult,
          revenue:           Math.round((revenueResult[0]?.total    || 0) * 100) / 100,
          received:          Math.round((revenueResult[0]?.received || 0) * 100) / 100,
          topProcedure:      topProcResult[0]?._id || null,
        };
      })
    );

    // Identifica o mês de maior e menor demanda
    const maxApts = Math.max(...monthsData.map((m) => m.totalAppointments));
    const minApts = Math.min(...monthsData.filter((m) => m.totalAppointments > 0).map((m) => m.totalAppointments));
    const peakMonth = monthsData.find((m) => m.totalAppointments === maxApts);
    const lowMonth  = monthsData.find((m) => m.totalAppointments === minApts && m.totalAppointments > 0);

    res.json({
      year,
      months:    monthsData,
      peak:      peakMonth  || null,
      low:       lowMonth   || null,
      totalYear: monthsData.reduce((s, m) => s + m.totalAppointments, 0),
      revenueYear: Math.round(monthsData.reduce((s, m) => s + m.revenue, 0) * 100) / 100,
    });
  } catch (error) {
    console.error("statsController.getTrendStats:", error);
    res.status(500).json({ error: "Erro ao calcular estatísticas" });
  }
};

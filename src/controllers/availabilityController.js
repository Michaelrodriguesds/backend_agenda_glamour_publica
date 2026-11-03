const Appointment = require("../models/Appointment");

// Máximo de agendamentos por slot (igual ao appointmentController)
const MAX_PER_SLOT = 2;

// Slots do dia — usa o horário configurado pelo negócio (req.currentUser),
// com fallback pras variáveis de ambiente/padrão se não houver config.
const generateSlots = (workStart, workEnd) => {
  const start = workStart ?? parseInt(process.env.WORK_START || 7);
  const end   = workEnd   ?? parseInt(process.env.WORK_END   || 21);
  const slots = [];
  for (let h = start; h <= end; h++) {
    slots.push(`${String(h).padStart(2, "0")}:00`);
    if (h < end) {
      slots.push(`${String(h).padStart(2, "0")}:30`);
    }
  }
  return slots;
};
// Slots: 07:00, 07:30, 08:00, 08:30, ..., 20:30, 21:00 (29 slots por padrão)

// ── Monta o objeto AppointmentInfo a partir de um doc do Mongoose ─
function buildAppointmentInfo(apt) {
  const procedures =
    Array.isArray(apt.procedures) && apt.procedures.length > 0
      ? apt.procedures
      : apt.procedure
      ? apt.procedure.split(" + ").map((s) => s.trim()).filter(Boolean)
      : [];

  return {
    id:         apt._id.toString(),
    clientName: apt.clientName,
    procedure:  apt.procedure || procedures.join(" + ") || "",
    procedures,
    location:   apt.location,
    confirmed:  apt.confirmed,
  };
}

// ────────────────────────────────────────────────────────────────
// SLOTS DISPONÍVEIS em um dia específico
// GET /api/availability?date=2025-03-01&location=Studio+Manilha
//
// ✅ NOVO: cada slot pode ter até MAX_PER_SLOT (2) agendamentos.
//   Resposta inclui campo `appointments` (array) além de `appointment`
//   (backward-compat com o primeiro item).
// ────────────────────────────────────────────────────────────────
exports.getDayAvailability = async (req, res) => {
  try {
    const { date, location } = req.query;
    if (!date) return res.status(400).json({ error: "Parâmetro 'date' é obrigatório" });

    const cfg = req.currentUser?.businessConfig;
    const ALL_SLOTS = generateSlots(cfg?.workStart, cfg?.workEnd);

    const start = new Date(date + "T00:00:00.000Z");
    const end   = new Date(date + "T23:59:59.999Z");

    const query = { userId: req.user.id, date: { $gte: start, $lte: end } };
    if (location) query.location = location;

    const allApts = await Appointment.find(query)
      .select("time location clientName procedure procedures confirmed")
      .sort({ time: 1 })
      .lean();

    // Agrupa por horário: { "09:00": [apt1, apt2], ... }
    const byTime = {};
    allApts.forEach((apt) => {
      if (!byTime[apt.time]) byTime[apt.time] = [];
      byTime[apt.time].push(apt);
    });

    const slots = ALL_SLOTS.map((time) => {
      const apts = byTime[time] || [];

      if (apts.length === 0) {
        return {
          time,
          available:    true,
          occupancy:    0,
          maxCapacity:  MAX_PER_SLOT,
          appointments: [],
          appointment:  null, // backward compat
        };
      }

      const mappedApts    = apts.map(buildAppointmentInfo);
      const isFullyBooked = apts.length >= MAX_PER_SLOT;

      return {
        time,
        available:    !isFullyBooked,   // livre se ainda há vaga
        occupancy:    apts.length,
        maxCapacity:  MAX_PER_SLOT,
        appointments: mappedApts,
        appointment:  mappedApts[0],    // backward compat (primeiro do slot)
      };
    });

    const freeCount       = slots.filter((s) => s.available).length;
    const fullyBooked     = slots.filter((s) => !s.available && s.appointments.length > 0).length;
    const partiallyBooked = slots.filter((s) => s.available && s.appointments.length > 0).length;

    res.json({
      date,
      location:       location || "Todos os locais",
      totalSlots:     ALL_SLOTS.length,
      freeSlots:      freeCount,
      bookedSlots:    fullyBooked,
      partialSlots:   partiallyBooked,
      status:         freeCount === 0 ? "full" : freeCount <= 3 ? "busy" : "available",
      slots,
    });
  } catch (error) {
    console.error("availabilityController.getDayAvailability:", error);
    res.status(500).json({ error: "Erro ao consultar disponibilidade" });
  }
};

// ────────────────────────────────────────────────────────────────
// STATUS DE DISPONIBILIDADE DO MÊS
// GET /api/availability/month?month=3&year=2025&location=...
//
// ✅ NOVO: considera slot "cheio" apenas quando tem MAX_PER_SLOT agendamentos.
//   status "partial" agora tem dois significados:
//     - dia com alguns slots ocupados (já existia)
//     - slots com 1 de 2 vagas preenchidas continuam aparecendo como disponíveis
// ────────────────────────────────────────────────────────────────
exports.getMonthAvailability = async (req, res) => {
  try {
    const { month, year, location } = req.query;
    if (!month || !year) {
      return res.status(400).json({ error: "Parâmetros 'month' e 'year' são obrigatórios" });
    }

    const m        = parseInt(month);
    const y        = parseInt(year);
    const firstDay = new Date(Date.UTC(y, m - 1, 1,  0,  0,  0,   0));
    const lastDay  = new Date(Date.UTC(y, m,     0, 23, 59, 59, 999));

    const cfg = req.currentUser?.businessConfig;
    const ALL_SLOTS = generateSlots(cfg?.workStart, cfg?.workEnd);

    const query = { userId: req.user.id, date: { $gte: firstDay, $lte: lastDay } };
    if (location) query.location = location;

    const appointments = await Appointment.find(query).select("date time confirmed").lean();

    // Agrupa por dia, depois por horário
    // byDay[d][time] = count
    const byDay = {};
    appointments.forEach((apt) => {
      const day = apt.date.getUTCDate();
      if (!byDay[day]) byDay[day] = {};
      if (!byDay[day][apt.time]) byDay[day][apt.time] = 0;
      byDay[day][apt.time]++;
    });

    const daysInMonth = lastDay.getUTCDate();
    const days = [];

    for (let d = 1; d <= daysInMonth; d++) {
      const dayOfWeek = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
      const isRest    = dayOfWeek === 0;

      if (isRest) {
        days.push({ day: d, status: "rest", freeSlots: 0, bookedSlots: 0 });
        continue;
      }

      const timeCounts = byDay[d] || {};

      // Conta slots totalmente preenchidos (>= MAX_PER_SLOT) e parcialmente
      let fullSlots    = 0;
      let partialSlots = 0;

      Object.values(timeCounts).forEach((count) => {
        if (count >= MAX_PER_SLOT) fullSlots++;
        else partialSlots++;
      });

      const totalOccupied = fullSlots + partialSlots;
      const free = ALL_SLOTS.length - fullSlots; // slots ainda com vaga

      let status;
      if (totalOccupied === 0) {
        status = "free";
      } else if (fullSlots >= Math.ceil(ALL_SLOTS.length * 0.75)) {
        status = "full";
      } else {
        status = "partial";
      }

      days.push({
        day: d,
        status,
        freeSlots:    free,
        bookedSlots:  fullSlots,
        partialSlots,
      });
    }

    res.json({
      month:      m,
      year:       y,
      location:   location || "Todos os locais",
      totalSlots: ALL_SLOTS.length,
      maxCapacity: MAX_PER_SLOT,
      days,
    });
  } catch (error) {
    console.error("availabilityController.getMonthAvailability:", error);
    res.status(500).json({ error: "Erro ao consultar disponibilidade" });
  }
};

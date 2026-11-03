const Appointment = require("../models/Appointment");

// ── Máximo de agendamentos simultâneos por slot ──────────────────
const MAX_PER_SLOT = 2;

// Limite de segurança da listagem sem filtro (tela "Clientes" carrega tudo)
const LIST_HARD_LIMIT = 5000;

// Campos que o app pode enviar. userId, _id, paidAt, confirmedAt, createdAt...
// NUNCA vêm do cliente (isso evitava que um usuário "passasse" um registro
// para outro usuário mandando um userId no corpo da requisição).
const ALLOWED_FIELDS = [
  "clientName", "procedures", "procedure", "date", "time", "location",
  "price", "paymentMethod", "paid", "confirmed", "notes",
];

const pickAllowed = (body = {}) => {
  const out = {};
  for (const k of ALLOWED_FIELDS) if (body[k] !== undefined) out[k] = body[k];
  return out;
};

// ── Helpers ──────────────────────────────────────────────────────

const buildFilters = (query) => {
  const filters = {};

  if (query.date) {
    const start = new Date(query.date + "T00:00:00.000Z");
    const end   = new Date(query.date + "T23:59:59.999Z");
    filters.date = { $gte: start, $lte: end };
  }

  if (query.month && query.year) {
    const m        = parseInt(query.month);
    const y        = parseInt(query.year);
    const firstDay = new Date(Date.UTC(y, m - 1, 1,  0,  0,  0,   0));
    const lastDay  = new Date(Date.UTC(y, m,     0, 23, 59, 59, 999));
    filters.date   = { $gte: firstDay, $lte: lastDay };
  }

  if (query.location) filters.location = String(query.location);

  // Escapa o texto digitado: antes ele virava uma regex crua (um "(" quebrava
  // a busca com erro 500 e dava pra montar regex pesada de propósito).
  const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  if (query.procedure) {
    const rx = esc(query.procedure);
    filters.$or = [
      { procedures: { $regex: rx, $options: "i" } },
      { procedure:  { $regex: rx, $options: "i" } },
    ];
  }

  if (query.paid      !== undefined) filters.paid      = query.paid      === "true";
  if (query.confirmed !== undefined) filters.confirmed = query.confirmed === "true";

  if (query.client) {
    filters.clientName = { $regex: esc(query.client), $options: "i" };
  }

  return filters;
};

const normalizeProcedures = (data) => {
  const hasArray  = Array.isArray(data.procedures) && data.procedures.length > 0;
  const hasString = typeof data.procedure === "string" && data.procedure.trim().length > 0;

  if (hasArray) {
    data.procedures = data.procedures.map((p) => String(p).trim()).filter(Boolean);
    data.procedure  = data.procedures.join(" + ");
  } else if (hasString) {
    data.procedures = data.procedure.split(" + ").map((s) => s.trim()).filter(Boolean);
  }
  return data;
};

const validationError = (res, error) => {
  const messages = Object.values(error.errors).map((e) => e.message);
  return res.status(400).json({ error: "Dados inválidos", messages });
};

// ────────────────────────────────────────────────────────────────
// LISTAR agendamentos
// GET /api/appointments
// ────────────────────────────────────────────────────────────────
exports.getAppointments = async (req, res) => {
  try {
    const filters = buildFilters(req.query);
    filters.userId = req.user.id;
    // lean(): devolve objetos simples (bem mais rápido e leve que documentos
    // Mongoose); o app só usa os campos reais, não os virtuais.
    const appointments = await Appointment.find(filters)
      .select("-__v")
      .sort({ date: 1, time: 1 })
      .limit(LIST_HARD_LIMIT)
      .lean();
    res.json({ count: appointments.length, data: appointments });
  } catch (error) {
    console.error("getAppointments:", error);
    res.status(500).json({ error: "Erro ao listar agendamentos" });
  }
};

// ────────────────────────────────────────────────────────────────
// BUSCAR por ID
// ────────────────────────────────────────────────────────────────
exports.getAppointmentById = async (req, res) => {
  try {
    const apt = await Appointment.findOne({ _id: req.params.id, userId: req.user.id }).lean();
    if (!apt) return res.status(404).json({ error: "Agendamento não encontrado" });
    res.json(apt);
  } catch (error) {
    console.error("getAppointmentById:", error);
    res.status(500).json({ error: "Erro ao buscar agendamento" });
  }
};

// ────────────────────────────────────────────────────────────────
// CRIAR agendamento
// POST /api/appointments
// Permite até MAX_PER_SLOT (2) agendamentos no mesmo horário/local.
// ────────────────────────────────────────────────────────────────
exports.createAppointment = async (req, res) => {
  try {
    const data = normalizeProcedures(pickAllowed(req.body));
    data.userId = req.user.id;

    const locations = req.currentUser?.businessConfig?.locations || [];
    if (!locations.includes(data.location)) {
      return res.status(400).json({ error: "Local inválido para o seu negócio" });
    }

    const slotCount = await countSlotOccupancy(req.user.id, data.date, data.time, data.location);
    if (slotCount >= MAX_PER_SLOT) {
      return res.status(409).json({
        error:   "Horário lotado",
        message: `Já existem ${MAX_PER_SLOT} agendamentos às ${data.time} no ${data.location} nesta data. Escolha outro horário.`,
        currentOccupancy: slotCount,
        maxCapacity: MAX_PER_SLOT,
      });
    }

    if (data.paid === true)      data.paidAt = new Date();
    if (data.confirmed === true) data.confirmedAt = new Date();

    const appointment = await Appointment.create(data);
    res.status(201).json(appointment);
  } catch (error) {
    if (error.name === "ValidationError") return validationError(res, error);
    console.error("createAppointment:", error);
    res.status(500).json({ error: "Erro ao criar agendamento" });
  }
};

// ────────────────────────────────────────────────────────────────
// ATUALIZAR agendamento
// ────────────────────────────────────────────────────────────────
exports.updateAppointment = async (req, res) => {
  try {
    const data = normalizeProcedures(pickAllowed(req.body));

    const current = await Appointment.findOne({ _id: req.params.id, userId: req.user.id })
      .select("date time location paid confirmed")
      .lean();
    if (!current) return res.status(404).json({ error: "Agendamento não encontrado" });

    if (data.location !== undefined) {
      const locations = req.currentUser?.businessConfig?.locations || [];
      if (!locations.includes(data.location)) {
        return res.status(400).json({ error: "Local inválido para o seu negócio" });
      }
    }

    // Se mudou data/horário/local, confere se o novo slot tem vaga
    // (sem contar o próprio agendamento).
    const moved = data.date !== undefined || data.time !== undefined || data.location !== undefined;
    if (moved) {
      const date     = data.date     ?? current.date;
      const time     = data.time     ?? current.time;
      const location = data.location ?? current.location;
      const slotCount = await countSlotOccupancy(req.user.id, date, time, location, req.params.id);
      if (slotCount >= MAX_PER_SLOT) {
        return res.status(409).json({
          error:   "Horário lotado",
          message: `Já existem ${MAX_PER_SLOT} agendamentos às ${time} no ${location} nesta data. Escolha outro horário.`,
          currentOccupancy: slotCount,
          maxCapacity: MAX_PER_SLOT,
        });
      }
    }

    // paidAt / confirmedAt acompanham o estado
    if (data.paid !== undefined && data.paid !== current.paid) {
      data.paidAt = data.paid ? new Date() : null;
    }
    if (data.confirmed !== undefined && data.confirmed !== current.confirmed) {
      data.confirmedAt = data.confirmed ? new Date() : null;
    }

    const apt = await Appointment.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id },
      { $set: data },
      { returnDocument: "after", runValidators: true }
    );
    if (!apt) return res.status(404).json({ error: "Agendamento não encontrado" });
    res.json(apt);
  } catch (error) {
    if (error.name === "ValidationError") return validationError(res, error);
    console.error("updateAppointment:", error);
    res.status(500).json({ error: "Erro ao atualizar agendamento" });
  }
};

// ────────────────────────────────────────────────────────────────
// DELETAR agendamento
// ────────────────────────────────────────────────────────────────
exports.deleteAppointment = async (req, res) => {
  try {
    const apt = await Appointment.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
    if (!apt) return res.status(404).json({ error: "Agendamento não encontrado" });
    res.json({ message: "Agendamento removido com sucesso" });
  } catch (error) {
    console.error("deleteAppointment:", error);
    res.status(500).json({ error: "Erro ao remover agendamento" });
  }
};

// ────────────────────────────────────────────────────────────────
// MARCAR COMO PAGO
// ────────────────────────────────────────────────────────────────
exports.markAsPaid = async (req, res) => {
  try {
    const apt = await Appointment.findOne({ _id: req.params.id, userId: req.user.id });
    if (!apt) return res.status(404).json({ error: "Agendamento não encontrado" });
    await apt.markAsPaid(req.body?.paymentMethod);
    res.json({ message: "Pagamento registrado com sucesso", data: apt });
  } catch (error) {
    if (error.name === "ValidationError") return validationError(res, error);
    console.error("markAsPaid:", error);
    res.status(500).json({ error: "Erro ao registrar pagamento" });
  }
};

// ────────────────────────────────────────────────────────────────
// CONFIRMAR CLIENTE
// ────────────────────────────────────────────────────────────────
exports.confirmAppointment = async (req, res) => {
  try {
    const apt = await Appointment.findOne({ _id: req.params.id, userId: req.user.id });
    if (!apt) return res.status(404).json({ error: "Agendamento não encontrado" });
    await apt.confirm();
    res.json({ message: "Agendamento confirmado com sucesso", data: apt });
  } catch (error) {
    console.error("confirmAppointment:", error);
    res.status(500).json({ error: "Erro ao confirmar agendamento" });
  }
};

// ── Auxiliar: conta quantos agendamentos há no slot ──────────────
// Número atual de agendamentos no horário+local+data do usuário.
// `excludeId` evita contar o próprio registro numa edição.
async function countSlotOccupancy(userId, date, time, location, excludeId = null) {
  const dateStr = typeof date === "string"
    ? date.split("T")[0]
    : new Date(date).toISOString().split("T")[0];

  const start = new Date(dateStr + "T00:00:00.000Z");
  const end   = new Date(dateStr + "T23:59:59.999Z");

  const query = { userId, date: { $gte: start, $lte: end }, time, location };
  if (excludeId) query._id = { $ne: excludeId };

  return Appointment.countDocuments(query);
}

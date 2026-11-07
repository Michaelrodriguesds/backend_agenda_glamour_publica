const Appointment      = require("../models/Appointment");
const ClientPreference = require("../models/ClientPreference");
const ReminderLog      = require("../models/ReminderLog");
const cfg              = require("../config/marketing");
const svc              = require("../services/marketing");

// ── Aba "Clientes & Marketing" (multi-negócio) ───────────────────
// REGRA DE OURO: toda consulta leva { userId: req.user.id }. Um negócio
// nunca enxerga clientes, agendamentos ou "Enviei" de outro.
// As rotas passam por `protect` + `checkTrial` (conta bloqueada não usa).

// Campos usados pela aba — nunca o documento inteiro.
const FIELDS = "clientName procedures procedure date time location price";

const today = () => svc.todayLocal(svc.clock.now(), cfg.TIMEZONE);

const isValidName = (name) => typeof name === "string" && name.trim().length > 0 && name.length <= 120;

// Serviços do negócio logado. O checkTrial já leu o usuário (com cache curto
// e invalidado quando a configuração é salva), então não custa consulta extra.
const servicesOf = (req) => req.currentUser?.businessConfig?.services || [];

const fail = (res, where, error) => {
  console.error(`marketingController.${where}:`, error);
  res.status(500).json({ error: "Erro ao carregar o marketing" });
};

// ── GET /api/marketing/reminders ─────────────────────────────────
// Agendadas para amanhã + clientes na hora de refazer.
exports.getReminders = async (req, res) => {
  try {
    const userId   = req.user.id;
    const t        = today();
    const tomorrow = svc.addDays(t, 1);
    const returnDaysMap = svc.returnDaysFromServices(servicesOf(req));

    const [tomorrowApts, allApts, prefs, logs] = await Promise.all([
      Appointment.find({
        userId,
        date: { $gte: svc.toUtcMidnight(tomorrow), $lt: svc.toUtcMidnight(svc.addDays(tomorrow, 1)) },
      }).select(FIELDS).lean(),
      // Sem nenhum serviço com prazo, não precisa ler o histórico.
      returnDaysMap.size ? Appointment.find({ userId }).select(FIELDS).lean() : Promise.resolve([]),
      ClientPreference.find({ userId }).lean(),
      ReminderLog.find({ userId }).select("key").lean(),
    ]);

    const prefsMap = svc.prefsToMap(prefs);
    const sentKeys = new Set((logs || []).map((l) => l.key));

    res.json({
      today:        t,
      tomorrow,
      // false = nenhum serviço tem "dias para retorno"; o app mostra uma dica.
      returnConfigured: returnDaysMap.size > 0,
      appointments: svc.buildTomorrowList(tomorrowApts, prefsMap, sentKeys),
      returns:      svc.buildReturnList(allApts, t, prefsMap, sentKeys, returnDaysMap, cfg),
    });
  } catch (error) {
    fail(res, "getReminders", error);
  }
};

// ── POST /api/marketing/reminders/sent ───────────────────────────
// Body: { key, type, clientName }. Idempotente: marcar 2x não duplica.
exports.markSent = async (req, res) => {
  try {
    const { key, type, clientName } = req.body || {};
    if (typeof key !== "string" || !key.trim() || key.length > 300) {
      return res.status(400).json({ error: "Campo 'key' inválido" });
    }
    if (!["appointment", "return", "campaign"].includes(type)) {
      return res.status(400).json({ error: "Campo 'type' inválido" });
    }

    const userId = req.user.id;
    await ReminderLog.updateOne(
      { userId, key },
      { $setOnInsert: { userId, key, type, clientName: typeof clientName === "string" ? clientName.trim().slice(0, 120) : "", sentAt: new Date() } },
      { upsert: true }
    );
    res.json({ ok: true, key });
  } catch (error) {
    fail(res, "markSent", error);
  }
};

// ── DELETE /api/marketing/reminders/sent?key=... ─────────────────
// Desfaz um "Enviei" tocado por engano (só do próprio negócio).
exports.unmarkSent = async (req, res) => {
  try {
    const key = req.query.key;
    if (typeof key !== "string" || !key.trim() || key.length > 300) {
      return res.status(400).json({ error: "Parâmetro 'key' inválido" });
    }
    await ReminderLog.deleteOne({ userId: req.user.id, key });
    res.json({ ok: true, key });
  } catch (error) {
    fail(res, "unmarkSent", error);
  }
};

// ── GET /api/marketing/movement ──────────────────────────────────
// Atendimentos por dia da semana e por período, últimos 90 dias.
exports.getMovement = async (req, res) => {
  try {
    const t     = today();
    const start = svc.addDays(t, -cfg.MOVEMENT_DAYS);
    const apts  = await Appointment.find({
      userId: req.user.id,
      date:   { $gte: svc.toUtcMidnight(start), $lt: svc.toUtcMidnight(t) },
    }).select("date time").lean();

    res.json(svc.buildMovement(apts, t, cfg.MOVEMENT_DAYS));
  } catch (error) {
    fail(res, "getMovement", error);
  }
};

// ── GET /api/marketing/segments ──────────────────────────────────
// Fiéis, sumidas e novas.
exports.getSegments = async (req, res) => {
  try {
    const t    = today();
    const apts = await Appointment.find({ userId: req.user.id }).select(FIELDS).lean();
    res.json({ today: t, ...svc.buildSegments(apts, t, cfg) });
  } catch (error) {
    fail(res, "getSegments", error);
  }
};

const prefResponse = (clientName, pref) => ({
  clientName,
  remindAppointment: pref ? pref.remindAppointment !== false : true,
  remindReturn:      pref ? pref.remindReturn !== false : true,
});

// ── GET /api/marketing/prefs/:clientName ─────────────────────────
exports.getPreference = async (req, res) => {
  try {
    const clientName = (req.params.clientName || "").trim();
    if (!isValidName(clientName)) return res.status(400).json({ error: "Nome inválido" });

    const pref = await ClientPreference.findOne({ userId: req.user.id, clientName }).lean();
    res.json(prefResponse(clientName, pref));
  } catch (error) {
    fail(res, "getPreference", error);
  }
};

// ── PUT /api/marketing/prefs/:clientName ─────────────────────────
// Body: { remindAppointment?: boolean, remindReturn?: boolean }
exports.updatePreference = async (req, res) => {
  try {
    const clientName = (req.params.clientName || "").trim();
    if (!isValidName(clientName)) return res.status(400).json({ error: "Nome inválido" });

    const body = req.body || {};
    const update = {};
    for (const field of ["remindAppointment", "remindReturn"]) {
      if (body[field] === undefined) continue;
      if (typeof body[field] !== "boolean") {
        return res.status(400).json({ error: `Campo '${field}' deve ser verdadeiro ou falso` });
      }
      update[field] = body[field];
    }
    if (Object.keys(update).length === 0) {
      return res.status(400).json({ error: "Nada para atualizar" });
    }

    const pref = await ClientPreference.findOneAndUpdate(
      { userId: req.user.id, clientName },
      { $set: update }, // no upsert, userId e nome vêm do filtro
      { upsert: true, returnDocument: "after", runValidators: true }
    ).lean();

    res.json(prefResponse(clientName, pref));
  } catch (error) {
    fail(res, "updatePreference", error);
  }
};

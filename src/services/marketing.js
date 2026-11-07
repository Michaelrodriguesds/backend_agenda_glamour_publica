// ── Lógica da aba "Clientes & Marketing" ─────────────────────────
// Funções PURAS: recebem listas de agendamentos já lidas do banco e
// devolvem o resultado. Não acessam o MongoDB nem o relógio direto, por
// isso são testadas com datas fixas em test/marketing.service.test.js.
//
// Convenção de datas do projeto: `date` é gravado à meia-noite UTC e o
// dia UTC representa o dia LOCAL escolhido (ex.: 2026-10-31T00:00:00Z =
// 31/10 no Brasil). Por isso trabalhamos com textos "AAAA-MM-DD"
// tirados do dia UTC, e "hoje" é calculado no fuso de Brasília.

const DAY_MS = 24 * 60 * 60 * 1000;

const WEEKDAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

// Relógio substituível nos testes.
const clock = { now: () => new Date() };

// "Hoje" no fuso informado, como "AAAA-MM-DD".
function todayLocal(now, timeZone) {
  // en-CA formata como AAAA-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year:  "numeric",
    month: "2-digit",
    day:   "2-digit",
  }).format(now);
}

// Dia de um agendamento ("AAAA-MM-DD"), a partir do dia UTC.
function dayStr(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function toUtcMidnight(str) {
  return new Date(str + "T00:00:00.000Z");
}

function addDays(str, n) {
  return dayStr(new Date(toUtcMidnight(str).getTime() + n * DAY_MS));
}

// Dias de `a` até `b` (b - a), ambos "AAAA-MM-DD".
function diffDays(a, b) {
  return Math.round((toUtcMidnight(b).getTime() - toUtcMidnight(a).getTime()) / DAY_MS);
}

function weekdayOf(str) {
  return toUtcMidnight(str).getUTCDay();
}

// Procedimentos de um agendamento (aceita o formato novo e o antigo).
function proceduresOf(apt) {
  if (Array.isArray(apt.procedures) && apt.procedures.length > 0) {
    return apt.procedures.filter((p) => typeof p === "string" && p.trim()).map((p) => p.trim());
  }
  if (typeof apt.procedure === "string" && apt.procedure.trim()) {
    return apt.procedure.split(" + ").map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

function cleanName(name) {
  return typeof name === "string" ? name.trim() : "";
}

// Mapa nome -> preferências. Sem registro = recebe tudo.
function prefFor(prefsMap, clientName) {
  const p = prefsMap.get(clientName);
  return {
    remindAppointment: p ? p.remindAppointment !== false : true,
    remindReturn:      p ? p.remindReturn !== false : true,
  };
}

function prefsToMap(prefs) {
  const map = new Map();
  for (const p of prefs || []) {
    const name = cleanName(p.clientName);
    if (name) map.set(name, p);
  }
  return map;
}

// Nome do serviço para comparação (sem diferença de maiúsculas/espaços).
function procKey(name) {
  return String(name || "").trim().toLowerCase();
}

// Mapa serviço -> dias para retorno, a partir da configuração do negócio
// (businessConfig.services). Só entram serviços com prazo > 0.
function returnDaysFromServices(services) {
  const map = new Map();
  for (const s of services || []) {
    const days = Number(s && s.returnDays);
    if (s && s.name && Number.isInteger(days) && days > 0) map.set(procKey(s.name), days);
  }
  return map;
}

function appointmentKey(id) {
  return `appt|${id}`;
}

function returnKey(clientName, procedure, lastDate) {
  return `return|${clientName}|${procedure}|${lastDate}`;
}

// ── 1. Agendadas para amanhã ─────────────────────────────────────
function buildTomorrowList(appointments, prefsMap, sentKeys) {
  const items = [];
  for (const apt of appointments || []) {
    const clientName = cleanName(apt.clientName);
    if (!clientName) continue;
    if (!prefFor(prefsMap, clientName).remindAppointment) continue;
    const key = appointmentKey(String(apt._id));
    items.push({
      key,
      type:       "appointment",
      id:         String(apt._id),
      clientName,
      date:       dayStr(apt.date),
      time:       apt.time || "",
      procedure:  proceduresOf(apt).join(" + "),
      location:   apt.location || "",
      sent:       sentKeys.has(key),
    });
  }
  items.sort((a, b) => a.time.localeCompare(b.time) || a.clientName.localeCompare(b.clientName));
  return items;
}

// ── 2. Hora de refazer ───────────────────────────────────────────
// Regras: conta do último atendimento JÁ PASSADO daquele procedimento;
// aparece do dia do prazo até prazo + janela; não aparece se a cliente
// tem qualquer horário de hoje em diante; respeita "não lembrar".
function buildReturnList(appointments, today, prefsMap, sentKeys, returnDaysMap, cfg) {
  const byClient = new Map(); // nome -> { hasUpcoming, lastByProc: Map }

  for (const apt of appointments || []) {
    const clientName = cleanName(apt.clientName);
    const d = dayStr(apt.date);
    if (!clientName || !d) continue;

    let c = byClient.get(clientName);
    if (!c) {
      c = { hasUpcoming: false, lastByProc: new Map() };
      byClient.set(clientName, c);
    }

    if (d >= today) {
      c.hasUpcoming = true;
      continue;
    }
    for (const proc of proceduresOf(apt)) {
      const prev = c.lastByProc.get(proc);
      if (!prev || d > prev) c.lastByProc.set(proc, d);
    }
  }

  const items = [];
  for (const [clientName, c] of byClient) {
    if (c.hasUpcoming) continue;
    if (!prefFor(prefsMap, clientName).remindReturn) continue;

    for (const [procedure, lastDate] of c.lastByProc) {
      // Prazo do serviço configurado pelo negócio. Sem prazo (0 ou serviço
      // que não existe mais na lista) = não lembra.
      const returnDays = returnDaysMap.get(procKey(procedure)) || 0;
      if (returnDays <= 0) continue;
      const daysSince  = diffDays(lastDate, today);
      if (daysSince < returnDays || daysSince > returnDays + cfg.RETURN_WINDOW_DAYS) continue;

      const key = returnKey(clientName, procedure, lastDate);
      items.push({
        key,
        type: "return",
        clientName,
        procedure,
        lastDate,
        daysSince,
        returnDays,
        sent: sentKeys.has(key),
      });
    }
  }

  // Mais atrasadas primeiro.
  items.sort((a, b) =>
    (b.daysSince - b.returnDays) - (a.daysSince - a.returnDays) ||
    a.clientName.localeCompare(b.clientName));
  return items;
}

// ── 3. Movimento por dia da semana e por período ─────────────────
// `appointments` = agendamentos de [hoje - N dias, ontem].
function periodOf(time) {
  const m = /^(\d{2}):(\d{2})$/.exec(time || "");
  if (!m) return null;
  const h = Number(m[1]);
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  return "evening";
}

function buildMovement(appointments, today, days) {
  const start = addDays(today, -days);

  // Quantas vezes cada dia da semana aparece no período (para a média).
  const occurrences = [0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < days; i++) {
    occurrences[weekdayOf(addDays(start, i))] += 1;
  }

  const counts  = [0, 0, 0, 0, 0, 0, 0];
  const periods = { morning: 0, afternoon: 0, evening: 0 };
  let total = 0;

  for (const apt of appointments || []) {
    const d = dayStr(apt.date);
    if (!d || d < start || d >= today) continue;
    counts[weekdayOf(d)] += 1;
    const p = periodOf(apt.time);
    if (p) periods[p] += 1;
    total += 1;
  }

  const weekdays = counts.map((count, weekday) => ({
    weekday,
    label:   WEEKDAY_LABELS[weekday],
    count,
    average: occurrences[weekday] ? Math.round((count / occurrences[weekday]) * 10) / 10 : 0,
  }));

  // Mais fraco / mais forte só entre os dias que tiveram atendimento
  // (um dia sempre fechado, como domingo, não é "dia fraco").
  const open = weekdays.filter((w) => w.count > 0);
  let weakest = null;
  let strongest = null;
  for (const w of open) {
    if (!weakest || w.average < weakest.average) weakest = w;
    if (!strongest || w.average > strongest.average) strongest = w;
  }
  const differencePercent =
    weakest && strongest && strongest.average > 0 && weakest !== strongest
      ? Math.round(((strongest.average - weakest.average) / strongest.average) * 100)
      : null;

  const periodTotal = periods.morning + periods.afternoon + periods.evening;
  const pct = (n) => (periodTotal ? Math.round((n / periodTotal) * 100) : 0);

  return {
    days,
    total,
    weekdays,
    weakest:   weakest ? { weekday: weakest.weekday, label: weakest.label, average: weakest.average } : null,
    strongest: strongest ? { weekday: strongest.weekday, label: strongest.label, average: strongest.average } : null,
    differencePercent,
    periods: [
      { key: "morning",   label: "Manhã",        count: periods.morning,   percent: pct(periods.morning) },
      { key: "afternoon", label: "Tarde",        count: periods.afternoon, percent: pct(periods.afternoon) },
      { key: "evening",   label: "Fim de tarde", count: periods.evening,   percent: pct(periods.evening) },
    ],
  };
}

// ── 4. Grupos de clientes ────────────────────────────────────────
function buildSegments(appointments, today, cfg) {
  const loyalStart = addDays(today, -cfg.LOYAL_DAYS);
  const byClient = new Map();

  for (const apt of appointments || []) {
    const clientName = cleanName(apt.clientName);
    const d = dayStr(apt.date);
    if (!clientName || !d) continue;

    let c = byClient.get(clientName);
    if (!c) {
      c = { clientName, visits: 0, recentVisits: 0, recentRevenue: 0, firstDate: null, lastDate: null, hasUpcoming: false };
      byClient.set(clientName, c);
    }

    if (d >= today) {
      c.hasUpcoming = true;
      continue;
    }
    c.visits += 1;
    if (!c.firstDate || d < c.firstDate) c.firstDate = d;
    if (!c.lastDate || d > c.lastDate) c.lastDate = d;
    if (d >= loyalStart) {
      c.recentVisits += 1;
      c.recentRevenue += Number(apt.price) || 0;
    }
  }

  const clients = [...byClient.values()].filter((c) => c.visits > 0);

  const loyal = clients
    .filter((c) => c.recentVisits >= cfg.LOYAL_MIN_VISITS)
    .sort((a, b) =>
      b.recentVisits - a.recentVisits ||
      b.recentRevenue - a.recentRevenue ||
      a.clientName.localeCompare(b.clientName))
    .slice(0, cfg.LOYAL_TOP)
    .map((c) => ({
      clientName: c.clientName,
      visits:     c.recentVisits,
      revenue:    Math.round(c.recentRevenue * 100) / 100,
      lastDate:   c.lastDate,
    }));

  const inactive = clients
    .filter((c) => !c.hasUpcoming && diffDays(c.lastDate, today) > cfg.INACTIVE_DAYS)
    .map((c) => ({
      clientName: c.clientName,
      visits:     c.visits,
      lastDate:   c.lastDate,
      daysSince:  diffDays(c.lastDate, today),
    }))
    // As que sumiram há menos tempo primeiro: mais fáceis de recuperar.
    .sort((a, b) => a.daysSince - b.daysSince || a.clientName.localeCompare(b.clientName));

  const newClients = clients
    .filter((c) => diffDays(c.firstDate, today) <= cfg.NEW_DAYS)
    .map((c) => ({
      clientName:  c.clientName,
      firstDate:   c.firstDate,
      daysSince:   diffDays(c.firstDate, today),
      hasUpcoming: c.hasUpcoming,
    }))
    .sort((a, b) => a.daysSince - b.daysSince || a.clientName.localeCompare(b.clientName));

  return { loyal, inactive, newClients };
}

module.exports = {
  clock,
  WEEKDAY_LABELS,
  todayLocal,
  dayStr,
  addDays,
  diffDays,
  toUtcMidnight,
  proceduresOf,
  prefsToMap,
  procKey,
  returnDaysFromServices,
  appointmentKey,
  returnKey,
  buildTomorrowList,
  buildReturnList,
  buildMovement,
  buildSegments,
};

// Rotas novas do BelaAgenda (clientes, marketing, dias de retorno),
// com foco em: cada negócio só enxerga os PRÓPRIOS dados e conta
// bloqueada não acessa. Banco simulado — nenhum dado real.
const request  = require("supertest");
const mongoose = require("mongoose");

jest.mock("../src/models/User");
jest.mock("../src/models/Appointment");
jest.mock("../src/models/ClientPreference");
jest.mock("../src/models/ReminderLog");
const User             = require("../src/models/User");
const Appointment      = require("../src/models/Appointment");
const ClientPreference = require("../src/models/ClientPreference");
const ReminderLog      = require("../src/models/ReminderLog");
const cache            = require("../src/utils/userCache");
const svc              = require("../src/services/marketing");
const { A, B, tokenFor, chain, userDoc, mockUsers, PAST } = require("./helpers");

const app = require("../src/app");
const d = (str) => new Date(str + "T00:00:00.000Z");

const SERVICES_A = [
  { name: "Cílios Tufinho", price: 120, active: true, returnDays: 15 },
  { name: "Manicure",       price: 40,  active: true, returnDays: 0 },
];

const realNow = svc.clock.now;
beforeEach(() => {
  jest.clearAllMocks();
  cache.clear();
  svc.clock.now = () => new Date("2026-10-30T15:00:00Z"); // sexta, 12h em Brasília
  mockUsers(User, {
    [A]: userDoc(A, { businessConfig: { businessName: "Studio A", services: SERVICES_A, locations: ["Centro"] } }),
    [B]: userDoc(B, { trialEndsAt: PAST(), planStatus: "blocked" }), // B está bloqueado
  });
});
afterAll(() => { svc.clock.now = realNow; });

describe("proteção: sem login = 401", () => {
  it.each([
    ["get", "/api/clients"],
    ["get", "/api/marketing/reminders"],
    ["get", "/api/marketing/movement"],
    ["get", "/api/marketing/segments"],
    ["post", "/api/marketing/reminders/sent"],
    ["delete", "/api/marketing/reminders/sent?key=x"],
    ["get", "/api/marketing/prefs/Maria"],
    ["put", "/api/marketing/prefs/Maria"],
  ])("%s %s", async (method, url) => {
    const res = await request(app)[method](url);
    expect(res.status).toBe(401);
  });
});

describe("plano: conta bloqueada = 403 TRIAL_EXPIRED", () => {
  it.each([
    ["get", "/api/clients"],
    ["get", "/api/marketing/reminders"],
    ["get", "/api/marketing/segments"],
  ])("%s %s", async (method, url) => {
    const res = await request(app)[method](url).set("Authorization", tokenFor(B));
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: "TRIAL_EXPIRED", businessId: "BBBB2222" });
    expect(Appointment.find).not.toHaveBeenCalled();
    expect(Appointment.aggregate).not.toHaveBeenCalled();
  });
});

describe("GET /api/clients", () => {
  it("agrupa no banco SÓ as clientes do negócio logado", async () => {
    Appointment.aggregate.mockResolvedValue([
      { _id: "Ana", count: 3, totalRevenue: 300, receivedRevenue: 200, pendingCount: 1, unconfirmedCount: 0, lastAppointment: d("2026-10-20") },
    ]);
    const res = await request(app).get("/api/clients").set("Authorization", tokenFor(A));

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.data[0]).toMatchObject({ clientName: "Ana", count: 3, pendingRevenue: 100 });

    const match = Appointment.aggregate.mock.calls[0][0][0].$match;
    expect(match.userId).toBeInstanceOf(mongoose.Types.ObjectId); // aggregate precisa de ObjectId
    expect(String(match.userId)).toBe(A);
  });

  it("busca com caracteres especiais não quebra (texto escapado)", async () => {
    Appointment.aggregate.mockResolvedValue([]);
    const res = await request(app).get("/api/clients?search=Ana (vip)").set("Authorization", tokenFor(A));
    expect(res.status).toBe(200);
    const match = Appointment.aggregate.mock.calls[0][0][0].$match;
    expect(match.clientName.$regex).toBe("Ana \\(vip\\)");
  });

  it("erro do banco vira 500 sem expor detalhes", async () => {
    Appointment.aggregate.mockRejectedValue(new Error("detalhe interno"));
    const res = await request(app).get("/api/clients").set("Authorization", tokenFor(A));
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain("detalhe interno");
  });
});

describe("GET /api/appointments?client=&clientExact=true", () => {
  it("filtra pelo nome exato e pelo negócio (formato que o app envia)", async () => {
    Appointment.find.mockReturnValue(chain([]));
    const res = await request(app).get("/api/appointments?client=Ana&clientExact=true").set("Authorization", tokenFor(A));
    expect(res.status).toBe(200);
    expect(Appointment.find.mock.calls[0][0]).toMatchObject({ clientName: "Ana", userId: A });
  });

  it("sem clientExact, 'client' continua sendo busca por pedaço", async () => {
    Appointment.find.mockReturnValue(chain([]));
    await request(app).get("/api/appointments?client=An").set("Authorization", tokenFor(A));
    expect(Appointment.find.mock.calls[0][0].clientName).toEqual({ $regex: "An", $options: "i" });
  });
});

describe("GET /api/marketing/reminders", () => {
  it("usa os dias de retorno dos serviços DO NEGÓCIO e filtra tudo por userId", async () => {
    const tomorrow = [{ _id: "a1", clientName: "Juliana", procedures: ["Manicure"], date: d("2026-10-31"), time: "09:00" }];
    const all = [
      ...tomorrow,
      { _id: "a2", clientName: "Ana", procedures: ["Cílios Tufinho"], date: d("2026-10-15"), time: "10:00" }, // 15 dias → lembra
      { _id: "a3", clientName: "Bia", procedures: ["Manicure"], date: d("2026-09-01"), time: "10:00" },       // prazo 0 → não
    ];
    Appointment.find.mockReturnValueOnce(chain(tomorrow)).mockReturnValueOnce(chain(all));
    ClientPreference.find.mockReturnValue(chain([]));
    ReminderLog.find.mockReturnValue(chain([{ key: "appt|a1" }]));

    const res = await request(app).get("/api/marketing/reminders").set("Authorization", tokenFor(A));

    expect(res.status).toBe(200);
    expect(res.body.returnConfigured).toBe(true);
    expect(res.body.appointments).toHaveLength(1);
    expect(res.body.appointments[0]).toMatchObject({ clientName: "Juliana", sent: true });
    expect(res.body.returns.map((r) => r.clientName)).toEqual(["Ana"]);
    expect(res.body.returns[0]).toMatchObject({ procedure: "Cílios Tufinho", returnDays: 15 });

    for (const call of Appointment.find.mock.calls) expect(call[0].userId).toBe(A);
    expect(ClientPreference.find.mock.calls[0][0]).toEqual({ userId: A });
    expect(ReminderLog.find.mock.calls[0][0]).toEqual({ userId: A });
  });

  it("negócio sem nenhum prazo: avisa e nem lê o histórico", async () => {
    mockUsers(User, { [A]: userDoc(A) }); // services: []
    Appointment.find.mockReturnValue(chain([]));
    ClientPreference.find.mockReturnValue(chain([]));
    ReminderLog.find.mockReturnValue(chain([]));

    const res = await request(app).get("/api/marketing/reminders").set("Authorization", tokenFor(A));
    expect(res.status).toBe(200);
    expect(res.body.returnConfigured).toBe(false);
    expect(res.body.returns).toEqual([]);
    expect(Appointment.find).toHaveBeenCalledTimes(1); // só a busca de amanhã
  });
});

describe("Enviei / desfazer", () => {
  it("marcar grava com userId (sem duplicar)", async () => {
    ReminderLog.updateOne.mockResolvedValue({});
    const res = await request(app).post("/api/marketing/reminders/sent")
      .set("Authorization", tokenFor(A)).send({ key: "appt|a1", type: "appointment", clientName: " Ana " });
    expect(res.status).toBe(200);
    const [filter, update, opts] = ReminderLog.updateOne.mock.calls[0];
    expect(filter).toEqual({ userId: A, key: "appt|a1" });
    expect(update.$setOnInsert).toMatchObject({ userId: A, clientName: "Ana", type: "appointment" });
    expect(opts).toEqual({ upsert: true });
  });

  it("valida key e type", async () => {
    const r1 = await request(app).post("/api/marketing/reminders/sent").set("Authorization", tokenFor(A)).send({ type: "appointment" });
    const r2 = await request(app).post("/api/marketing/reminders/sent").set("Authorization", tokenFor(A)).send({ key: "x", type: "spam" });
    expect(r1.status).toBe(400);
    expect(r2.status).toBe(400);
    expect(ReminderLog.updateOne).not.toHaveBeenCalled();
  });

  it("desfazer só apaga do próprio negócio", async () => {
    ReminderLog.deleteOne.mockResolvedValue({});
    const res = await request(app).delete("/api/marketing/reminders/sent?key=appt|a1").set("Authorization", tokenFor(A));
    expect(res.status).toBe(200);
    expect(ReminderLog.deleteOne).toHaveBeenCalledWith({ userId: A, key: "appt|a1" });
  });
});

describe("movimento e grupos", () => {
  it("movimento lê só os 90 dias do negócio", async () => {
    Appointment.find.mockReturnValue(chain([{ date: d("2026-10-27"), time: "10:00" }]));
    const res = await request(app).get("/api/marketing/movement").set("Authorization", tokenFor(A));
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    const q = Appointment.find.mock.calls[0][0];
    expect(q.userId).toBe(A);
    expect(q.date.$gte.toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });

  it("grupos filtram por userId", async () => {
    Appointment.find.mockReturnValue(chain([]));
    const res = await request(app).get("/api/marketing/segments").set("Authorization", tokenFor(A));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ loyal: [], inactive: [], newClients: [] });
    expect(Appointment.find.mock.calls[0][0]).toEqual({ userId: A });
  });
});

describe("preferências da cliente", () => {
  it("sem registro = recebe tudo", async () => {
    ClientPreference.findOne.mockReturnValue(chain(null));
    const res = await request(app).get("/api/marketing/prefs/Ana").set("Authorization", tokenFor(A));
    expect(res.body).toEqual({ clientName: "Ana", remindAppointment: true, remindReturn: true });
    expect(ClientPreference.findOne).toHaveBeenCalledWith({ userId: A, clientName: "Ana" });
  });

  it("salvar usa userId + nome e valida booleanos", async () => {
    ClientPreference.findOneAndUpdate.mockReturnValue(chain({ remindAppointment: true, remindReturn: false }));
    const ok = await request(app).put("/api/marketing/prefs/Ana").set("Authorization", tokenFor(A)).send({ remindReturn: false });
    expect(ok.status).toBe(200);
    expect(ok.body.remindReturn).toBe(false);
    expect(ClientPreference.findOneAndUpdate.mock.calls[0][0]).toEqual({ userId: A, clientName: "Ana" });

    const bad = await request(app).put("/api/marketing/prefs/Ana").set("Authorization", tokenFor(A)).send({ remindReturn: "não" });
    expect(bad.status).toBe(400);
  });
});

describe("PUT /api/business/config — dias para retorno", () => {
  // Documento "de verdade" simulado (o controller altera e chama save()).
  const docWith = (services) => {
    const doc = { businessConfig: { services, locations: ["Centro"], workStart: 7, workEnd: 21 }, save: jest.fn().mockResolvedValue() };
    User.findById.mockImplementation(() => Promise.resolve(doc));
    return doc;
  };

  it("salva o prazo informado", async () => {
    const doc = docWith([]);
    const res = await request(app).put("/api/business/config").set("Authorization", tokenFor(A))
      .send({ services: [{ name: "Cílios", price: 100, returnDays: 21 }] });
    expect(res.status).toBe(200);
    expect(doc.businessConfig.services).toEqual([{ name: "Cílios", price: 100, active: true, returnDays: 21 }]);
  });

  it("app antigo que não manda o campo NÃO zera o prazo já salvo", async () => {
    const doc = docWith([{ name: "Cílios", price: 100, active: true, returnDays: 21 }]);
    const res = await request(app).put("/api/business/config").set("Authorization", tokenFor(A))
      .send({ services: [{ name: "cílios", price: 110 }, { name: "Novo" }] });
    expect(res.status).toBe(200);
    expect(doc.businessConfig.services).toEqual([
      { name: "cílios", price: 110, active: true, returnDays: 21 },
      { name: "Novo", price: 0, active: true, returnDays: 0 },
    ]);
  });

  it("salva o nome do dono (saudação) e recusa nome enorme", async () => {
    const doc = docWith([]);
    const ok = await request(app).put("/api/business/config").set("Authorization", tokenFor(A)).send({ ownerName: "  Ana Paula " });
    expect(ok.status).toBe(200);
    expect(doc.businessConfig.ownerName).toBe("Ana Paula");
    const bad = await request(app).put("/api/business/config").set("Authorization", tokenFor(A)).send({ ownerName: "x".repeat(61) });
    expect(bad.status).toBe(400);
  });

  it.each([[-1], [366], [2.5], ["abc"]])("prazo inválido (%p) = 400 e nada salvo", async (v) => {
    const doc = docWith([]);
    const res = await request(app).put("/api/business/config").set("Authorization", tokenFor(A))
      .send({ services: [{ name: "Cílios", returnDays: v }] });
    expect(res.status).toBe(400);
    expect(doc.save).not.toHaveBeenCalled();
  });
});

describe("GET /api/stats/trend — ano em 2 agregações", () => {
  it("faz só 2 consultas, filtradas pelo negócio, e monta os meses", async () => {
    Appointment.aggregate
      .mockResolvedValueOnce([{ _id: 1, count: 4, total: 400, received: 300 }, { _id: 3, count: 1, total: 50, received: 50 }])
      .mockResolvedValueOnce([{ _id: 1, topProcedure: "Corte" }]);

    const res = await request(app).get("/api/stats/trend?year=2025").set("Authorization", tokenFor(A));

    expect(res.status).toBe(200);
    expect(Appointment.aggregate).toHaveBeenCalledTimes(2); // antes: até 36
    for (const call of Appointment.aggregate.mock.calls) {
      const match = call[0][0].$match;
      expect(String(match.userId)).toBe(A);
      expect(match.userId).toBeInstanceOf(mongoose.Types.ObjectId);
    }
    expect(res.body.months).toHaveLength(12); // ano passado: 12 meses
    expect(res.body.months[0]).toMatchObject({ month: 1, totalAppointments: 4, revenue: 400, received: 300, topProcedure: "Corte" });
    expect(res.body.months[1]).toMatchObject({ month: 2, totalAppointments: 0, topProcedure: null });
    expect(res.body).toMatchObject({ totalYear: 5, revenueYear: 450 });
    expect(res.body.peak.month).toBe(1);
    expect(res.body.low.month).toBe(3);
  });

  it("sem 'year' = 400", async () => {
    const res = await request(app).get("/api/stats/trend").set("Authorization", tokenFor(A));
    expect(res.status).toBe(400);
  });
});

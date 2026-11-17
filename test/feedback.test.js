// Relatos dos usuários (erro/melhoria) e aviso global de manutenção.
// Banco simulado — nenhum dado real.
const request = require("supertest");

jest.mock("../src/models/User");
jest.mock("../src/models/Feedback");
jest.mock("../src/models/Announcement");
const User         = require("../src/models/User");
const Feedback     = require("../src/models/Feedback");
const Announcement = require("../src/models/Announcement");
const cache        = require("../src/utils/userCache");
const annCtrl      = require("../src/controllers/announcementController");
const { A, tokenFor, chain, userDoc, PAST } = require("./helpers");

process.env.ADMIN_KEY = "chave-de-teste-admin";
const ADMIN = { "x-admin-key": "chave-de-teste-admin" };
const app = require("../src/app");

beforeEach(() => {
  jest.clearAllMocks();
  cache.clear();
  annCtrl._clearCache();
});

describe("POST /api/feedback (usuário)", () => {
  const login = () => User.findById.mockImplementation(() =>
    chain(userDoc(A, { businessConfig: { businessName: "Studio A", services: [], locations: ["Centro"] } })));

  it("sem login = 401", async () => {
    const r = await request(app).post("/api/feedback").send({ message: "teste de erro" });
    expect(r.status).toBe(401);
  });

  it("grava com os dados do TOKEN/banco, nunca do corpo", async () => {
    login();
    Feedback.create.mockResolvedValue({});
    const r = await request(app).post("/api/feedback").set("Authorization", tokenFor(A))
      .send({ type: "bug", message: "O calendário trava ao abrir", userId: "OUTRO", businessId: "ZZZZ9999", status: "resolvido" });
    expect(r.status).toBe(201);
    const arg = Feedback.create.mock.calls[0][0];
    expect(String(arg.userId)).toBe(A);
    expect(arg.businessId).toBe("AAAA1111");
    expect(arg.businessName).toBe("Studio A");
    expect(arg.type).toBe("bug");
    expect(arg.status).toBeUndefined(); // status não vem do cliente
  });

  it("conta bloqueada também consegue enviar (sem checkTrial)", async () => {
    User.findById.mockImplementation(() => chain(userDoc(A, { trialEndsAt: PAST(), planStatus: "blocked" })));
    Feedback.create.mockResolvedValue({});
    const r = await request(app).post("/api/feedback").set("Authorization", tokenFor(A)).send({ message: "estou bloqueado e preciso de ajuda" });
    expect(r.status).toBe(201);
  });

  it("mensagem curta ou longa demais = 400", async () => {
    login();
    const h = tokenFor(A);
    expect((await request(app).post("/api/feedback").set("Authorization", h).send({ message: "oi" })).status).toBe(400);
    expect((await request(app).post("/api/feedback").set("Authorization", h).send({ message: "x".repeat(1001) })).status).toBe(400);
    expect(Feedback.create).not.toHaveBeenCalled();
  });

  it("tipo desconhecido vira 'outro'", async () => {
    login(); Feedback.create.mockResolvedValue({});
    await request(app).post("/api/feedback").set("Authorization", tokenFor(A)).send({ type: "hack", message: "mensagem válida aqui" });
    expect(Feedback.create.mock.calls[0][0].type).toBe("outro");
  });
});

describe("/api/admin/feedback", () => {
  it("sem chave = 401", async () => {
    expect((await request(app).get("/api/admin/feedback")).status).toBe(401);
    expect((await request(app).delete("/api/admin/feedback/64b000000000000000000009")).status).toBe(401);
  });

  it("lista com contagem de novos", async () => {
    Feedback.find.mockReturnValue(chain([{ _id: "64b000000000000000000009", businessId: "AAAA1111", email: "a@a.com",
      businessName: "Studio A", type: "melhoria", message: "Queria relatório PDF", status: "novo", createdAt: new Date() }]));
    Feedback.countDocuments.mockResolvedValue(1);
    const r = await request(app).get("/api/admin/feedback?status=novo").set(ADMIN);
    expect(r.status).toBe(200);
    expect(r.body.novos).toBe(1);
    expect(r.body.data[0]).toMatchObject({ negocio: "Studio A", tipo: "melhoria", businessId: "AAAA1111" });
    expect(Feedback.find.mock.calls[0][0]).toEqual({ status: "novo" });
  });

  it("muda status, valida status e ID", async () => {
    const id = "64b000000000000000000009";
    Feedback.findByIdAndUpdate.mockReturnValue(chain({ _id: id, status: "lido", type: "bug", message: "x" }));
    expect((await request(app).patch(`/api/admin/feedback/${id}`).set(ADMIN).send({ status: "lido" })).status).toBe(200);
    expect((await request(app).patch(`/api/admin/feedback/${id}`).set(ADMIN).send({ status: "xyz" })).status).toBe(400);
    expect((await request(app).patch("/api/admin/feedback/abc").set(ADMIN).send({ status: "lido" })).status).toBe(400);
  });

  it("apaga; inexistente = 404", async () => {
    const id = "64b000000000000000000009";
    Feedback.findByIdAndDelete.mockResolvedValueOnce({ _id: id }).mockResolvedValueOnce(null);
    expect((await request(app).delete(`/api/admin/feedback/${id}`).set(ADMIN)).status).toBe(200);
    expect((await request(app).delete(`/api/admin/feedback/${id}`).set(ADMIN)).status).toBe(404);
  });
});

describe("aviso de manutenção", () => {
  it("GET /api/status é público e sem aviso devolve null", async () => {
    Announcement.findOne.mockReturnValue(chain(null));
    const r = await request(app).get("/api/status");
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ announcement: null });
  });

  it("aviso ativo aparece para todos; inativo não", async () => {
    Announcement.findOne.mockReturnValue(chain({ active: true, type: "maintenance", message: "Manutenção hoje às 22h", updatedAt: new Date() }));
    let r = await request(app).get("/api/status");
    expect(r.body.announcement).toMatchObject({ type: "maintenance", message: "Manutenção hoje às 22h" });

    annCtrl._clearCache();
    Announcement.findOne.mockReturnValue(chain({ active: false, type: "info", message: "antigo" }));
    r = await request(app).get("/api/status");
    expect(r.body.announcement).toBeNull();
  });

  it("usa cache: 2 chamadas seguidas = 1 consulta ao banco", async () => {
    Announcement.findOne.mockReturnValue(chain(null));
    await request(app).get("/api/status");
    await request(app).get("/api/status");
    expect(Announcement.findOne).toHaveBeenCalledTimes(1);
  });

  it("erro no banco não derruba o app: responde sem aviso", async () => {
    Announcement.findOne.mockImplementation(() => { throw new Error("db off"); });
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const r = await request(app).get("/api/status");
    spy.mockRestore();
    expect(r.status).toBe(200);
    expect(r.body.announcement).toBeNull();
  });

  it("admin: exige chave", async () => {
    expect((await request(app).get("/api/admin/announcement")).status).toBe(401);
    expect((await request(app).put("/api/admin/announcement").send({ active: true, message: "x" })).status).toBe(401);
  });

  it("admin: ativar exige mensagem; limite de 300; tipo inválido vira info", async () => {
    expect((await request(app).put("/api/admin/announcement").set(ADMIN).send({ active: true, message: "" })).status).toBe(400);
    expect((await request(app).put("/api/admin/announcement").set(ADMIN).send({ active: true, message: "x".repeat(301) })).status).toBe(400);

    Announcement.findOneAndUpdate.mockReturnValue(chain({ active: true, type: "info", message: "Atualização às 22h", updatedAt: new Date() }));
    const r = await request(app).put("/api/admin/announcement").set(ADMIN).send({ active: true, type: "hack", message: "Atualização às 22h" });
    expect(r.status).toBe(200);
    expect(Announcement.findOneAndUpdate.mock.calls[0][1].$set.type).toBe("info");
  });

  it("admin: ao salvar, o cache zera e o app vê o aviso na hora", async () => {
    Announcement.findOne.mockReturnValue(chain(null));
    expect((await request(app).get("/api/status")).body.announcement).toBeNull();

    Announcement.findOneAndUpdate.mockReturnValue(chain({ active: true, type: "maintenance", message: "Voltamos em 30 min", updatedAt: new Date() }));
    await request(app).put("/api/admin/announcement").set(ADMIN).send({ active: true, type: "maintenance", message: "Voltamos em 30 min" });

    Announcement.findOne.mockReturnValue(chain({ active: true, type: "maintenance", message: "Voltamos em 30 min", updatedAt: new Date() }));
    expect((await request(app).get("/api/status")).body.announcement.message).toBe("Voltamos em 30 min");
  });
});

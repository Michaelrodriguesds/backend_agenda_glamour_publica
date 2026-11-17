// Painel admin: excluir usuário inativo e senha temporária. Banco simulado.
const request = require("supertest");

jest.mock("../src/models/User");
jest.mock("../src/models/Appointment");
jest.mock("../src/models/Note");
jest.mock("../src/models/ClientPreference");
jest.mock("../src/models/ReminderLog");
jest.mock("../src/models/Feedback");
jest.mock("../src/models/Announcement");
const User             = require("../src/models/User");
const Appointment      = require("../src/models/Appointment");
const Note             = require("../src/models/Note");
const ClientPreference = require("../src/models/ClientPreference");
const ReminderLog      = require("../src/models/ReminderLog");
const Feedback         = require("../src/models/Feedback");
const cache            = require("../src/utils/userCache");
const { FUTURE, PAST } = require("./helpers");

process.env.ADMIN_KEY = "chave-de-teste-admin";
const ADMIN = { "x-admin-key": "chave-de-teste-admin" };
const app = require("../src/app");

const ID = "64b0000000000000000000aa";
// Documento "vivo" (com métodos) como o Mongoose devolve.
const doc = (over = {}) => ({
  _id: ID, businessId: "AAAA1111", email: "a@teste.com",
  trialEndsAt: PAST(), unlockedUntil: null,
  resetCodeHash: "x", resetCodeExpires: new Date(), resetAttempts: 3,
  hasActiveAccess() { return Math.max(+this.trialEndsAt || 0, +this.unlockedUntil || 0) > Date.now(); },
  setPassword: jest.fn(async function (p) { this.passwordHash = "hash:" + p; }),
  save: jest.fn(async () => {}),
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  cache.clear();
  for (const M of [Appointment, Note, ClientPreference, ReminderLog, Feedback]) M.deleteMany.mockResolvedValue({ deletedCount: 2 });
  User.deleteOne.mockResolvedValue({ deletedCount: 1 });
});

describe("DELETE /api/admin/users/:businessId", () => {
  it("sem chave admin = 401/403 e nada é apagado", async () => {
    const r = await request(app).delete("/api/admin/users/AAAA1111?confirm=AAAA1111");
    expect([401, 403]).toContain(r.status);
    expect(User.deleteOne).not.toHaveBeenCalled();
  });

  it("ID inexistente = 404", async () => {
    User.findOne.mockResolvedValue(null);
    const r = await request(app).delete("/api/admin/users/ZZZZ9999?confirm=ZZZZ9999").set(ADMIN);
    expect(r.status).toBe(404);
  });

  it("sem confirmação (ou errada) = 400 e nada é apagado", async () => {
    User.findOne.mockResolvedValue(doc());
    expect((await request(app).delete("/api/admin/users/AAAA1111").set(ADMIN)).status).toBe(400);
    expect((await request(app).delete("/api/admin/users/AAAA1111?confirm=OUTRO").set(ADMIN)).status).toBe(400);
    expect(User.deleteOne).not.toHaveBeenCalled();
    expect(Appointment.deleteMany).not.toHaveBeenCalled();
  });

  it("usuário COM acesso ativo = 409 (bloqueie antes) e nada é apagado", async () => {
    User.findOne.mockResolvedValue(doc({ trialEndsAt: FUTURE() }));
    const r = await request(app).delete("/api/admin/users/AAAA1111?confirm=AAAA1111").set(ADMIN);
    expect(r.status).toBe(409);
    expect(User.deleteOne).not.toHaveBeenCalled();
    expect(Appointment.deleteMany).not.toHaveBeenCalled();
  });

  it("usuário vencido + confirmação certa: apaga SÓ os dados dele e a conta", async () => {
    User.findOne.mockResolvedValue(doc());
    const r = await request(app).delete("/api/admin/users/aaaa1111?confirm=aaaa1111").set(ADMIN);
    expect(r.status).toBe(200);
    for (const M of [Appointment, Note, ClientPreference, ReminderLog, Feedback]) {
      expect(M.deleteMany).toHaveBeenCalledTimes(1);
      expect(M.deleteMany).toHaveBeenCalledWith({ userId: ID }); // filtro por dono, nunca vazio
    }
    expect(User.deleteOne).toHaveBeenCalledWith({ _id: ID });
    expect(r.body.apagados).toEqual({ agendamentos: 2, notas: 2, clientes: 2, lembretes: 2, relatos: 2 });
  });

  it("limpa o cache do usuário excluído", async () => {
    cache.set(ID, { x: 1 });
    User.findOne.mockResolvedValue(doc());
    await request(app).delete("/api/admin/users/AAAA1111?confirm=AAAA1111").set(ADMIN);
    expect(cache.get(ID)).toBeNull();
  });

  it("falha no banco = 500 sem apagar a conta", async () => {
    User.findOne.mockResolvedValue(doc());
    Note.deleteMany.mockRejectedValue(new Error("boom"));
    const r = await request(app).delete("/api/admin/users/AAAA1111?confirm=AAAA1111").set(ADMIN);
    expect(r.status).toBe(500);
    expect(User.deleteOne).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/admin/users/:businessId/reset-password", () => {
  it("sem chave admin = 401/403", async () => {
    const r = await request(app).patch("/api/admin/users/AAAA1111/reset-password");
    expect([401, 403]).toContain(r.status);
  });

  it("404 se o ID não existe", async () => {
    User.findOne.mockResolvedValue(null);
    expect((await request(app).patch("/api/admin/users/ZZZZ9999/reset-password").set(ADMIN)).status).toBe(404);
  });

  it("gera senha aleatória de 10 caracteres, grava só o hash e cancela código pendente", async () => {
    const u = doc();
    User.findOne.mockResolvedValue(u);
    const r = await request(app).patch("/api/admin/users/AAAA1111/reset-password").set(ADMIN);
    expect(r.status).toBe(200);
    expect(r.body.tempPassword).toMatch(/^[A-Za-z2-9]{10}$/);
    expect(r.body.tempPassword).not.toMatch(/[0OlI1]/);
    expect(u.setPassword).toHaveBeenCalledWith(r.body.tempPassword);
    expect(u.passwordHash).toBe("hash:" + r.body.tempPassword);
    expect(u.resetCodeHash).toBeNull();
    expect(u.resetAttempts).toBe(0);
    expect(u.save).toHaveBeenCalled();
    expect(r.headers["cache-control"]).toMatch(/no-store/);
  });

  it("duas chamadas geram senhas diferentes", async () => {
    User.findOne.mockResolvedValue(doc());
    const a = (await request(app).patch("/api/admin/users/AAAA1111/reset-password").set(ADMIN)).body.tempPassword;
    const b = (await request(app).patch("/api/admin/users/AAAA1111/reset-password").set(ADMIN)).body.tempPassword;
    expect(a).not.toBe(b);
  });
});

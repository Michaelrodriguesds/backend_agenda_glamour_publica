// Comportamentos que JÁ existiam no BelaAgenda e não podem mudar
// depois da separação server.js → src/app.js. Banco simulado.
const request = require("supertest");
const jwt     = require("jsonwebtoken");

jest.mock("../src/models/User");
jest.mock("../src/models/Appointment");
const User        = require("../src/models/User");
const Appointment = require("../src/models/Appointment");
const cache       = require("../src/utils/userCache");
const { A, B, tokenFor, chain, userDoc, mockUsers } = require("./helpers");

const app = require("../src/app");

beforeEach(() => {
  jest.clearAllMocks();
  cache.clear();
  mockUsers(User, { [A]: userDoc(A, { businessConfig: { services: [], locations: ["Centro"] } }) });
});

describe("app", () => {
  it("GET / responde online", async () => {
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.body.status).toContain("BelaAgenda");
  });

  it("rota inexistente = 404", async () => {
    const res = await request(app).get("/api/nao-existe");
    expect(res.status).toBe(404);
  });

  it("JSON malformado = 400 (não 500)", async () => {
    const res = await request(app).post("/api/auth/login").set("Content-Type", "application/json").send("{oi");
    expect(res.status).toBe(400);
  });

  it("cabeçalhos de segurança (helmet) continuam ativos", async () => {
    const res = await request(app).get("/");
    expect(res.headers["x-powered-by"]).toBeUndefined();
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });
});

describe("autenticação", () => {
  it("token antigo (sem id, da versão de usuário único) = 401", async () => {
    const old = `Bearer ${jwt.sign({ username: "glamour" }, process.env.JWT_SECRET)}`;
    const res = await request(app).get("/api/appointments").set("Authorization", old);
    expect(res.status).toBe(401);
  });

  it("token de outro segredo = 401", async () => {
    const fake = `Bearer ${jwt.sign({ id: A }, "outro-segredo")}`;
    const res = await request(app).get("/api/appointments").set("Authorization", fake);
    expect(res.status).toBe(401);
  });

  it("usuário apagado = 401", async () => {
    const res = await request(app).get("/api/appointments").set("Authorization", tokenFor(B));
    expect(res.status).toBe(401);
  });
});

describe("agendamentos continuam presos ao negócio", () => {
  it("criar usa o userId do TOKEN, nunca o do corpo", async () => {
    Appointment.countDocuments.mockResolvedValue(0);
    Appointment.create.mockImplementation(async (data) => ({ _id: "n1", ...data }));
    const res = await request(app).post("/api/appointments").set("Authorization", tokenFor(A)).send({
      userId: B, clientName: "Ana", procedures: ["Cílios"], date: "2026-11-10", time: "10:00", location: "Centro", price: 100,
    });
    expect(res.status).toBe(201);
    expect(Appointment.create.mock.calls[0][0].userId).toBe(A);
  });

  it("local que não é do negócio = 400", async () => {
    const res = await request(app).post("/api/appointments").set("Authorization", tokenFor(A)).send({
      clientName: "Ana", procedures: ["Cílios"], date: "2026-11-10", time: "10:00", location: "Outro", price: 100,
    });
    expect(res.status).toBe(400);
    expect(Appointment.create).not.toHaveBeenCalled();
  });

  it("listar filtra pelo negócio", async () => {
    Appointment.find.mockReturnValue(chain([]));
    await request(app).get("/api/appointments?date=2026-11-10").set("Authorization", tokenFor(A));
    expect(Appointment.find.mock.calls[0][0].userId).toBe(A);
  });
});

// Ajudantes dos testes: tokens de dois negócios e o "banco simulado".
const jwt = require("jsonwebtoken");

// Dois negócios diferentes (tenants). Os testes conferem que o A nunca
// consulta dados do B.
const A = "64b000000000000000000001";
const B = "64b000000000000000000002";

const tokenFor = (id) => `Bearer ${jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: "1h" })}`;

// Simula o encadeamento do Mongoose: Model.find(...).select(...).sort(...).lean()
const chain = (data) => {
  const q = { select: () => q, sort: () => q, limit: () => q, lean: () => Promise.resolve(data) };
  return q;
};

const FUTURE = () => new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
const PAST   = () => new Date(Date.now() - 24 * 60 * 60 * 1000);

// Usuário como o checkTrial lê do banco (sem senha, sem logo).
const userDoc = (id, over = {}) => ({
  _id: id,
  businessId: id === A ? "AAAA1111" : "BBBB2222",
  email: `${id}@teste.com`,
  planStatus: "trial",
  trialEndsAt: FUTURE(),
  unlockedUntil: null,
  businessConfig: { businessName: "Negócio", services: [], locations: ["Studio"] },
  ...over,
});

// Faz o User simulado responder ao checkTrial. `users` = { id: doc }.
function mockUsers(User, users) {
  User.findById.mockImplementation((id) => chain(users[String(id)] || null));
  User.updateOne.mockReturnValue(Promise.resolve({}));
  User.accessExpiry.mockImplementation((u) => Math.max(
    u.trialEndsAt ? new Date(u.trialEndsAt).getTime() : 0,
    u.unlockedUntil ? new Date(u.unlockedUntil).getTime() : 0,
  ));
}

module.exports = { A, B, tokenFor, chain, userDoc, mockUsers, FUTURE, PAST };

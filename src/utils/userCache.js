// Cache em memória do usuário (documento "lean") usado por checkTrial.
// Antes: TODA requisição protegida fazia um findById só pra checar o trial.
// Agora: 1 consulta a cada TTL por usuário. A expiração do trial é
// reavaliada a cada requisição com a data em cache (então o bloqueio no
// minuto exato continua valendo); só mudanças feitas por você (admin) ou
// pelo próprio usuário (config) precisam invalidar o cache — e elas invalidam.
//
// Obs.: o cache é por instância do servidor. Com 1 instância (plano padrão do
// Render) a liberação é instantânea; com várias, vale no máximo TTL segundos.
const TTL_MS = Number(process.env.USER_CACHE_TTL_MS || 30000);
const MAX_ENTRIES = 5000;
const store = new Map(); // id -> { user, at }

function get(id) {
  const e = store.get(id);
  if (!e) return null;
  if (Date.now() - e.at > TTL_MS) { store.delete(id); return null; }
  return e.user;
}
function set(id, user) {
  if (store.size >= MAX_ENTRIES) store.delete(store.keys().next().value); // descarta o mais antigo
  store.set(id, { user, at: Date.now() });
}
function invalidate(id) { store.delete(String(id)); }
function clear() { store.clear(); }

module.exports = { get, set, invalidate, clear };

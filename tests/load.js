// uso: BASE=... node load.js  -> semeia 1 usuário com 300 agendamentos e mede endpoints
const autocannon = require('autocannon');
const BASE = process.env.BASE || 'http://localhost:5055';
const post = async (p, b, t) => { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: JSON.stringify(b) }); return { s: r.status, d: await r.json().catch(() => null) }; };
const run = (opts) => new Promise((res) => autocannon(opts, (e, r) => res(r)));
(async () => {
  const email = `load${Date.now()}@t.com`;
  let r = await post('/api/auth/register', { email, password: '123456', businessName: 'Carga' });
  const token = r.d.token;
  await fetch(BASE + '/api/business/config', { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ locations: ['Centro', 'Praia'], services: [{ name: 'Cílios', price: 100 }] }) });
  const now = new Date(); const y = now.getUTCFullYear(), m = now.getUTCMonth() + 1;
  let ok = 0; const t0 = Date.now();
  for (let i = 0; i < 300; i++) {
    const day = 1 + (i % 28), hh = 7 + Math.floor((i / 28) % 13);
    const body = { clientName: 'Cliente ' + (i % 60), procedures: ['Cílios'], date: `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`, time: `${String(hh).padStart(2, '0')}:${i % 2 ? '30' : '00'}`, location: i % 2 ? 'Praia' : 'Centro', price: 100 };
    const x = await post('/api/appointments', body, token); if (x.s === 201) ok++;
  }
  console.log(`semeados ${ok}/300 em ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  const H = { Authorization: 'Bearer ' + token };
  const targets = [
    ['GET /api/appointments?month (lista do mês)', `/api/appointments?month=${m}&year=${y}`],
    ['GET /api/appointments (todos – tela Clientes)', `/api/appointments`],
    ['GET /api/availability?date (slots do dia)', `/api/availability?date=${y}-${String(m).padStart(2, '0')}-10&location=Centro`],
    ['GET /api/availability/month (calendário)', `/api/availability/month?month=${m}&year=${y}`],
    ['GET /api/auth/me', `/api/auth/me`],
    ['GET /api/business/config', `/api/business/config`],
  ];
  const out = [];
  for (const [name, path] of targets) {
    const r = await run({ url: BASE + path, connections: 20, duration: 8, headers: H });
    out.push({ name, rps: Math.round(r.requests.average), p50: r.latency.p50, p97: r.latency.p97_5, p99: r.latency.p99, errs: r.errors + r.non2xx, kb: Math.round(r.throughput.average / 1024) });
  }
  const lg = await run({ url: BASE + '/api/auth/login', method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: '123456' }), connections: 10, duration: 6 });
  out.push({ name: 'POST /api/auth/login (bcrypt)', rps: Math.round(lg.requests.average), p50: lg.latency.p50, p97: lg.latency.p97_5, p99: lg.latency.p99, errs: lg.errors + lg.non2xx, kb: 0 });
  console.table(out);
  process.exit(0);
})();

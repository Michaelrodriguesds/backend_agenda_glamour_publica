// Testa limitadores de taxa, força bruta do código de reset, trust proxy e expiração natural do trial
const fs = require('fs');
const BASE = process.env.BASE || 'http://localhost:5057';
const LOG = process.env.SERVER_LOG;
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
let pass = 0, fail = 0;
const check = (n, c, x) => { c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log('  FAIL ' + n + (x ? ' -> ' + JSON.stringify(x).slice(0, 160) : ''))); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(method, path, { token, body, ip } = {}) {
  const h = { 'Content-Type': 'application/json' };
  if (token) h.Authorization = 'Bearer ' + token; if (ip) h['X-Forwarded-For'] = ip;
  const r = await fetch(BASE + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  let d = null; try { d = await r.json(); } catch (_) {} return { status: r.status, data: d };
}
(async () => {
  const stamp = Date.now(); const email = `sec${stamp}@t.com`;
  console.log('# Força bruta de LOGIN (10 tentativas / 15 min por IP+e-mail)');
  let r = await api('POST', '/api/auth/register', { body: { email, password: '123456' }, ip: '9.9.9.9' });
  const token = r.data.token; const userId = r.data.user._id;
  let last; let firstBlocked = -1;
  for (let i = 1; i <= 12; i++) { last = await api('POST', '/api/auth/login', { body: { email, password: 'errada' }, ip: '1.1.1.1' }); if (last.status === 429 && firstBlocked < 0) firstBlocked = i; }
  check('11ª tentativa errada é bloqueada com 429', firstBlocked === 11, firstBlocked);
  r = await api('POST', '/api/auth/login', { body: { email, password: '123456' }, ip: '1.1.1.1' });
  check('mesmo IP+e-mail continua bloqueado (mesmo com senha certa)', r.status === 429, r.status);
  r = await api('POST', '/api/auth/login', { body: { email, password: '123456' }, ip: '2.2.2.2' });
  check('OUTRO IP (trust proxy / X-Forwarded-For) NÃO é afetado → usuários não dividem cota', r.status === 200, r.status);
  r = await api('POST', '/api/auth/login', { body: { email: `outro${stamp}@t.com`, password: 'x' }, ip: '1.1.1.1' });
  check('outro e-mail no mesmo IP não é bloqueado', r.status === 401, r.status);

  console.log('# Pedido de código (5 / 15 min)');
  let blocked = -1; for (let i = 1; i <= 7; i++) { const x = await api('POST', '/api/auth/forgot-password', { body: { email }, ip: '3.3.3.3' }); if (x.status === 429 && blocked < 0) blocked = i; }
  check('6º pedido de código é bloqueado', blocked === 6, blocked);

  console.log('# Força bruta do CÓDIGO de redefinição (máx. 5 erros)');
  const email2 = `sec2_${stamp}@t.com`;
  await api('POST', '/api/auth/register', { body: { email: email2, password: '123456' }, ip: '8.8.8.8' });
  await api('POST', '/api/auth/forgot-password', { body: { email: email2 }, ip: '4.4.4.4' }); await sleep(400);
  const txt = fs.readFileSync(LOG, 'utf8'); const m = [...txt.matchAll(/(\d{6})<\/p>/g)]; const code = m[m.length - 1][1];
  const wrong = code === '111111' ? '222222' : '111111';
  for (let i = 0; i < 5; i++) await api('POST', '/api/auth/reset-password', { body: { email: email2, code: wrong, newPassword: 'nova1234' }, ip: `5.5.5.${i}` });
  r = await api('POST', '/api/auth/reset-password', { body: { email: email2, code, newPassword: 'nova1234' }, ip: '5.5.5.99' });
  check('após 5 códigos errados, o código CERTO deixa de funcionar', r.status === 400, r);

  console.log('# Limite global (50 req/min neste teste)');
  let got429 = 0; for (let i = 0; i < 70; i++) { const x = await api('GET', '/api/business/config', { token, ip: '6.6.6.6' }); if (x.status === 429) got429++; }
  check('excesso de requisições é barrado (429)', got429 > 0, got429);
  r = await api('GET', '/api/business/config', { token, ip: '7.7.7.7' });
  check('outro IP segue normal', r.status === 200, r.status);
  const h = await fetch(BASE + '/health', { headers: { 'X-Forwarded-For': '6.6.6.6' } });
  check('/health nunca é limitado (keep-alive do Render)', h.status === 200, h.status);

  console.log('# Expiração NATURAL do trial (sem ação do admin)');
  await mongoose.connect(process.env.MONGO_URI);
  const U = mongoose.connection.collection('users'); const oid = new mongoose.Types.ObjectId(userId);
  await U.updateOne({ _id: oid }, { $set: { trialEndsAt: new Date(Date.now() + 2500), unlockedUntil: null } });
  r = await api('GET', '/api/auth/login', {}); // aquece nada; só garante servidor vivo
  const tk = (await api('POST', '/api/auth/login', { body: { email, password: '123456' }, ip: '2.2.2.2' })).data.token;
  r = await api('GET', '/api/appointments', { token: tk, ip: '7.7.7.7' });
  check('dentro do prazo: acesso liberado (e usuário entra no cache)', r.status === 200, r.status);
  await sleep(3200);
  r = await api('GET', '/api/appointments', { token: tk, ip: '7.7.7.7' });
  check('passou do prazo: bloqueia NA HORA, mesmo com usuário em cache', r.status === 403 && r.data.error === 'TRIAL_EXPIRED', r);
  const u = await U.findOne({ _id: oid });
  await sleep(300);
  const u2 = await U.findOne({ _id: oid });
  check("campo planStatus gravado vira 'blocked'", u2.planStatus === 'blocked', u2.planStatus);
  r = await api('GET', '/api/auth/me', { token: tk, ip: '7.7.7.7' });
  check('/me mostra status correto (blocked) e o ID', r.status === 200 && r.data.planStatus === 'blocked' && r.data.businessId, r.data);

  console.log(`\nRESULTADO: ${pass} ok, ${fail} falhas`); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERRO', e); process.exit(2); });

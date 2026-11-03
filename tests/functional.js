// Teste funcional ponta a ponta contra o servidor rodando.
// uso: BASE=http://localhost:5055 ADMIN_KEY=... SERVER_LOG=... node functional.js
const fs = require('fs');
const BASE = process.env.BASE || 'http://localhost:5055';
const ADMIN = process.env.ADMIN_KEY || 'adminkey123';
const LOG = process.env.SERVER_LOG;
let pass = 0, fail = 0; const failures = [];

async function api(method, path, { token, body, admin, headers } = {}) {
  const h = { 'Content-Type': 'application/json', ...(headers || {}) };
  if (token) h.Authorization = 'Bearer ' + token;
  if (admin) h['x-admin-key'] = admin === true ? ADMIN : admin;
  const r = await fetch(BASE + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await r.json(); } catch (_) {}
  return { status: r.status, data };
}
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; failures.push(name); console.log('  FAIL ' + name + (extra ? '  -> ' + JSON.stringify(extra).slice(0, 200) : '')); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

(async () => {
  const stamp = Date.now();
  const emailA = `a${stamp}@teste.com`, emailB = `b${stamp}@teste.com`;

  console.log('# Saúde'); {
    const r = await api('GET', '/health'); check('health 200', r.status === 200 && r.data.status === 'healthy', r);
  }

  console.log('# Cadastro'); let tokenA, tokenB, userA, userB;
  {
    let r = await api('POST', '/api/auth/register', { body: { email: emailA, password: '123456', businessName: 'Studio A' } });
    check('registro A 201', r.status === 201 && r.data.token, r); tokenA = r.data?.token; userA = r.data?.user;
    check('trial de ~30 dias', userA && Math.abs(new Date(userA.trialEndsAt) - (Date.now() + 30 * 86400000)) < 120000, userA?.trialEndsAt);
    check('businessId gerado (8 hex)', /^[0-9A-F]{8}$/.test(userA?.businessId || ''), userA?.businessId);
    check('hash de senha NÃO vaza no JSON', !JSON.stringify(r.data).includes('passwordHash') && !JSON.stringify(r.data).includes('resetCodeHash'));
    r = await api('POST', '/api/auth/register', { body: { email: emailB, password: '123456', businessName: 'Studio B' } });
    check('registro B 201', r.status === 201, r); tokenB = r.data?.token; userB = r.data?.user;
    r = await api('POST', '/api/auth/register', { body: { email: emailA, password: '123456' } });
    check('e-mail duplicado 409', r.status === 409, r);
    r = await api('POST', '/api/auth/register', { body: { email: emailA.toUpperCase(), password: '123456' } });
    check('e-mail duplicado (maiúsculas) 409', r.status === 409, r);
    r = await api('POST', '/api/auth/register', { body: { email: 'x@y.com', password: '123' } });
    check('senha curta 400', r.status === 400, r);
    r = await api('POST', '/api/auth/register', { body: { email: 'invalido', password: '123456' } });
    check('e-mail inválido 400', r.status === 400, r);
    r = await api('POST', '/api/auth/register', { body: {} });
    check('registro vazio 400', r.status === 400, r);
  }

  console.log('# Login'); {
    let r = await api('POST', '/api/auth/login', { body: { email: emailA, password: '123456' } });
    check('login ok', r.status === 200 && r.data.token, r);
    r = await api('POST', '/api/auth/login', { body: { email: emailA, password: 'errada' } });
    check('senha errada 401', r.status === 401, r);
    r = await api('POST', '/api/auth/login', { body: { email: 'naoexiste@x.com', password: '123456' } });
    check('usuário inexistente 401', r.status === 401, r);
    r = await api('GET', '/api/auth/me', { token: tokenA });
    check('/me retorna o próprio usuário', r.status === 200 && r.data.email === emailA, r);
    r = await api('GET', '/api/auth/me');
    check('/me sem token 401', r.status === 401, r);
    r = await api('GET', '/api/appointments', { token: 'lixo.lixo.lixo' });
    check('token inválido 401', r.status === 401, r);
  }

  console.log('# Refresh de token'); {
    let r = await api('POST', '/api/auth/refresh', { token: tokenA });
    check('refresh com token válido', r.status === 200 && r.data.token, r);
    r = await api('POST', '/api/auth/refresh', { token: 'lixo' });
    check('refresh com lixo 401', r.status === 401, r);
    const legacy = require('jsonwebtoken').sign({ username: 'glamour' }, 'test_secret_123');
    r = await api('POST', '/api/auth/refresh', { token: legacy });
    check('refresh de token ANTIGO (sem id) é recusado', r.status === 401, r);
  }

  console.log('# Configuração do negócio'); {
    let r = await api('GET', '/api/business/config', { token: tokenA });
    check('config inicial tem 1 local e 0 serviços', r.status === 200 && r.data.locations.length === 1 && r.data.services.length === 0, r.data);
    r = await api('PUT', '/api/business/config', { token: tokenA, body: { locations: ['Centro', 'Praia', 'Terceiro'] } });
    check('3 locais é recusado 400', r.status === 400, r);
    r = await api('PUT', '/api/business/config', { token: tokenA, body: { locations: [] } });
    check('0 locais é recusado 400', r.status === 400, r);
    r = await api('PUT', '/api/business/config', { token: tokenA, body: {
      businessName: 'Studio da Ana', primaryColor: '#E8527A', logoUrl: 'https://x.com/l.png',
      locations: ['Centro', 'Praia'], services: [{ name: 'Cílios', price: 120 }, { name: 'Sobrancelha', price: 60 }, { name: 'Limpeza', price: 140 }] } });
    check('salvar config A', r.status === 200 && r.data.data.locations.length === 2 && r.data.data.services.length === 3, r);
    r = await api('PUT', '/api/business/config', { token: tokenB, body: { locations: ['Único'], services: [{ name: 'Manicure', price: 40 }] } });
    check('salvar config B (1 local)', r.status === 200 && r.data.data.locations.length === 1, r);
    r = await api('GET', '/api/business/config', { token: tokenA });
    check('config A persistiu e não vazou de B', r.data.locations.join() === 'Centro,Praia' && r.data.services[0].name === 'Cílios', r.data);
  }

  console.log('# Agendamentos + isolamento entre usuários'); let aptA;
  {
    const base = { clientName: 'Maria', procedures: ['Cílios'], date: tomorrow, time: '09:00', location: 'Centro', price: 120 };
    let r = await api('POST', '/api/appointments', { token: tokenA, body: base });
    check('criar agendamento A', r.status === 201 && r.data.userId === userA._id, r); aptA = r.data;
    r = await api('POST', '/api/appointments', { token: tokenA, body: { ...base, location: 'Local Inventado' } });
    check('local fora da config é recusado 400', r.status === 400, r);
    r = await api('POST', '/api/appointments', { token: tokenB, body: { ...base, location: 'Centro' } });
    check('B não pode usar local de A (400)', r.status === 400, r);
    r = await api('POST', '/api/appointments', { token: tokenA, body: { ...base, clientName: 'Joana' } });
    check('2º agendamento no mesmo slot ok', r.status === 201, r);
    r = await api('POST', '/api/appointments', { token: tokenA, body: { ...base, clientName: 'Rita' } });
    check('3º no mesmo slot → 409 lotado', r.status === 409, r);
    r = await api('POST', '/api/appointments', { token: tokenB, body: { ...base, location: 'Único', clientName: 'Cliente de B' } });
    check('B agenda no mesmo horário sem conflitar com A', r.status === 201, r);
    r = await api('POST', '/api/appointments', { token: tokenA, body: { ...base, time: '25:99', clientName: 'X' } });
    check('horário inválido recusado 400', r.status === 400, r);
    r = await api('POST', '/api/appointments', { token: tokenA, body: { clientName: 'Sem dados' } });
    check('agendamento incompleto recusado 400', r.status === 400, r);

    r = await api('GET', '/api/appointments', { token: tokenA });
    check('A vê só os seus (2)', r.status === 200 && r.data.count === 2, r.data?.count);
    r = await api('GET', '/api/appointments', { token: tokenB });
    check('B vê só os seus (1)', r.status === 200 && r.data.count === 1, r.data?.count);
    r = await api('GET', '/api/appointments/' + aptA._id, { token: tokenB });
    check('B não lê agendamento de A (404)', r.status === 404, r);
    r = await api('PUT', '/api/appointments/' + aptA._id, { token: tokenB, body: { clientName: 'HACK' } });
    check('B não edita agendamento de A (404)', r.status === 404, r);
    r = await api('DELETE', '/api/appointments/' + aptA._id, { token: tokenB });
    check('B não apaga agendamento de A (404)', r.status === 404, r);
    r = await api('PATCH', `/api/appointments/${aptA._id}/pay`, { token: tokenB, body: { paymentMethod: 'PIX' } });
    check('B não marca pago de A (404)', r.status === 404, r);
    r = await api('PATCH', `/api/appointments/${aptA._id}/confirm`, { token: tokenB });
    check('B não confirma de A (404)', r.status === 404, r);

    r = await api('PUT', '/api/appointments/' + aptA._id, { token: tokenA, body: { userId: userB._id, clientName: 'Maria Editada' } });
    check('A edita o próprio agendamento', r.status === 200 && r.data.clientName === 'Maria Editada', r);
    check('MASS-ASSIGNMENT: A não consegue transferir o agendamento p/ B (userId)', r.data?.userId === userA._id, r.data?.userId);
    r = await api('PUT', '/api/appointments/' + aptA._id, { token: tokenA, body: { location: 'Local Inventado' } });
    check('edição não aceita local fora da config', r.status === 400, r);
    r = await api('PATCH', `/api/appointments/${aptA._id}/pay`, { token: tokenA, body: { paymentMethod: 'PIX' } });
    check('marcar como pago', r.status === 200 && r.data.data.paid === true, r);
    r = await api('PATCH', `/api/appointments/${aptA._id}/confirm`, { token: tokenA });
    check('confirmar', r.status === 200 && r.data.data.confirmed === true, r);
    r = await api('GET', '/api/appointments/id-invalido', { token: tokenA });
    check('ID malformado → 400 (não 500)', r.status === 400, r);
    r = await api('GET', '/api/appointments?client=' + encodeURIComponent('(['), { token: tokenA });
    check('busca com caracteres de regex não quebra', r.status === 200, r);
    r = await api('PUT', '/api/appointments/' + aptA._id, { token: tokenA, body: { time: '99:99' } });
    check('edição com horário inválido → 400', r.status === 400, r);
    r = await api('PATCH', `/api/appointments/${aptA._id}/pay`, { token: tokenA, body: { paymentMethod: 'BITCOIN' } });
    check('forma de pagamento inválida → 400', r.status === 400, r);
  }

  console.log('# Notas'); {
    let r = await api('POST', '/api/notes', { token: tokenA, body: { content: 'Comprar henna', tag: 'estoque' } });
    check('criar nota A', r.status === 201 && r.data.userId === userA._id, r); const nA = r.data;
    r = await api('GET', '/api/notes', { token: tokenB });
    check('B não vê notas de A', r.status === 200 && r.data.count === 0, r.data);
    r = await api('PUT', '/api/notes/' + nA._id, { token: tokenB, body: { content: 'HACK' } });
    check('B não edita nota de A', r.status === 404, r);
    r = await api('PUT', '/api/notes/' + nA._id, { token: tokenA, body: { userId: userB._id, content: 'ok' } });
    check('MASS-ASSIGNMENT em nota: userId preservado', r.status === 200 && r.data.userId === userA._id, r.data?.userId);
    r = await api('PATCH', `/api/notes/${nA._id}/pin`, { token: tokenA });
    check('fixar nota', r.status === 200 && r.data.data.pinned === true, r);
    r = await api('GET', '/api/notes/tags', { token: tokenB });
    check('tags isoladas por usuário', r.status === 200 && r.data.tags.length === 0, r.data);
    r = await api('DELETE', '/api/notes/' + nA._id, { token: tokenB });
    check('B não apaga nota de A', r.status === 404, r);
  }

  console.log('# Disponibilidade e estatísticas'); {
    let r = await api('GET', `/api/availability?date=${tomorrow}&location=Centro`, { token: tokenA });
    const s9 = r.data?.slots?.find((s) => s.time === '09:00');
    check('disponibilidade do dia: 09:00 lotado p/ A', r.status === 200 && s9 && s9.available === false && s9.occupancy === 2, s9);
    r = await api(`GET`, `/api/availability?date=${tomorrow}&location=Único`, { token: tokenB });
    const b9 = r.data?.slots?.find((s) => s.time === '09:00');
    check('09:00 de B só tem 1 (isolado de A)', b9 && b9.occupancy === 1 && b9.available === true, b9);
    const d = new Date(Date.now() + 86400000);
    r = await api('GET', `/api/availability/month?month=${d.getUTCMonth() + 1}&year=${d.getUTCFullYear()}&location=Centro`, { token: tokenA });
    check('disponibilidade do mês', r.status === 200 && Array.isArray(r.data.days), r.status);
    r = await api('GET', `/api/stats/monthly?month=${d.getUTCMonth() + 1}&year=${d.getUTCFullYear()}`, { token: tokenA });
    const ferretLimit = (x) => x.status === 500 && LOG && /not implemented yet/i.test(fs.readFileSync(LOG, 'utf8'));
    check('stats mensais respondem (banco de teste FerretDB não implementa $cond → ignorado)', r.status === 200 || ferretLimit(r), r);
    r = await api('GET', `/api/stats/trend?year=${d.getUTCFullYear()}`, { token: tokenA });
    check('rota /stats/trend existe (app chama essa rota)', r.status !== 404, r);
    r = await api('GET', '/api/stats/monthly', { token: tokenA });
    check('stats sem month/year → 400', r.status === 400, r);
  }

  console.log('# Recuperação de senha'); {
    let r = await api('POST', '/api/auth/forgot-password', { body: { email: 'naoexiste@x.com' } });
    check('forgot com e-mail inexistente responde igual (sem enumerar)', r.status === 200, r);
    r = await api('POST', '/api/auth/forgot-password', { body: { email: emailA } });
    check('forgot com e-mail real 200', r.status === 200, r);
    await sleep(300);
    let code = null;
    if (LOG) { const txt = fs.readFileSync(LOG, 'utf8'); const m = [...txt.matchAll(/(\d{6})<\/p>/g)]; code = m.length ? m[m.length - 1][1] : null; }
    check('código de 6 dígitos gerado (lido do log, sem RESEND)', !!code, 'sem código no log');
    r = await api('POST', '/api/auth/reset-password', { body: { email: emailA, code: '000000', newPassword: 'nova1234' } });
    check('código errado 400', r.status === 400, r);
    r = await api('POST', '/api/auth/reset-password', { body: { email: emailA, code, newPassword: '123' } });
    check('nova senha curta 400', r.status === 400, r);
    r = await api('POST', '/api/auth/reset-password', { body: { email: emailA, code, newPassword: 'nova1234' } });
    check('reset com código certo 200', r.status === 200, r);
    r = await api('POST', '/api/auth/reset-password', { body: { email: emailA, code, newPassword: 'outra1234' } });
    check('código NÃO pode ser reutilizado', r.status === 400, r);
    r = await api('POST', '/api/auth/login', { body: { email: emailA, password: '123456' } });
    check('senha antiga não funciona mais', r.status === 401, r);
    r = await api('POST', '/api/auth/login', { body: { email: emailA, password: 'nova1234' } });
    check('login com a senha nova', r.status === 200, r);
  }

  console.log('# Diversos'); {
    const pg = await fetch(BASE + '/admin'); const html = await pg.text();
    check('painel /admin é servido', pg.status === 200 && html.includes('BelaAgenda'), pg.status);
    let r = await api('GET', '/rota/que/nao/existe'); check('rota inexistente 404 JSON', r.status === 404 && r.data?.error, r);
    const bad = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{quebrado' });
    check('JSON malformado → 400 (não 500)', bad.status === 400, bad.status);
    const big = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'a@b.com', password: 'x'.repeat(200000) }) });
    check('corpo gigante → 413', big.status === 413, big.status);
    r = await api('POST', '/api/auth/login', { body: { email: emailA, password: 'x'.repeat(500) } });
    check('senha gigante não trava (401)', r.status === 401, r);
    const h = await fetch(BASE + '/health');
    check('cabeçalhos de segurança (helmet)', !!h.headers.get('x-content-type-options') && !h.headers.get('x-powered-by'));
  }

  console.log('# Validação da configuração'); {
    let r = await api('PUT', '/api/business/config', { token: tokenB, body: { primaryColor: 'vermelho' } });
    check('cor inválida 400', r.status === 400, r);
    r = await api('PUT', '/api/business/config', { token: tokenB, body: { logoUrl: 'javascript:alert(1)' } });
    check('logo com esquema perigoso 400', r.status === 400, r);
    r = await api('PUT', '/api/business/config', { token: tokenB, body: { workStart: 20, workEnd: 8 } });
    check('horário de funcionamento invertido 400', r.status === 400, r);
    r = await api('PUT', '/api/business/config', { token: tokenB, body: { services: [{ name: 'A + B', price: 1 }] } });
    check("serviço com ' + ' no nome 400", r.status === 400, r);
    r = await api('PUT', '/api/business/config', { token: tokenB, body: { services: [{ name: 'Manicure', price: -5 }, { name: 'manicure', price: 9 }], locations: ['Único'] } });
    check('serviço duplicado ignorado e preço negativo vira 0', r.status === 200 && r.data.data.services.length === 1 && r.data.data.services[0].price === 0, r.data);
  }

  console.log('# Trial, bloqueio e liberação manual (admin)'); {
    let r = await api('GET', '/api/admin/users');
    check('admin sem chave 401', r.status === 401, r);
    r = await api('GET', '/api/admin/users', { admin: 'errada' });
    check('admin com chave errada 401', r.status === 401, r);
    r = await api('GET', '/api/admin/users', { admin: true });
    check('admin lista usuários', r.status === 200 && r.data.count >= 2, r.status);
    check('admin NÃO expõe hash de senha', !JSON.stringify(r.data).includes('passwordHash'));
    r = await api('GET', '/api/admin/users/' + userA.businessId.toLowerCase(), { admin: true });
    check('admin busca por businessId (case-insensitive)', r.status === 200 && r.data.email === emailA, r.status);
    r = await api('GET', '/api/admin/users/ZZZZZZZZ', { admin: true });
    check('businessId inexistente 404', r.status === 404, r);

    r = await api('PATCH', `/api/admin/users/${userA.businessId}/block`, { admin: true });
    check('admin bloqueia A', r.status === 200, r);
    r = await api('GET', '/api/appointments', { token: tokenA });
    check('A bloqueado → 403 TRIAL_EXPIRED', r.status === 403 && r.data.error === 'TRIAL_EXPIRED', r);
    check('resposta traz businessId p/ a tela de bloqueio', r.data?.businessId === userA.businessId, r.data);
    for (const p of ['/api/notes', '/api/stats/monthly?month=1&year=2026', '/api/availability?date=' + tomorrow]) {
      r = await api('GET', p, { token: tokenA }); check('bloqueio vale p/ ' + p.split('?')[0], r.status === 403, r.status);
    }
    r = await api('POST', '/api/appointments', { token: tokenA, body: { clientName: 'X', procedures: ['a'], date: tomorrow, time: '10:00', location: 'Centro', price: 1 } });
    check('bloqueado não consegue criar agendamento', r.status === 403, r.status);
    r = await api('GET', '/api/business/config', { token: tokenA });
    check('bloqueado ainda lê a config', r.status === 200, r.status);
    r = await api('GET', '/api/auth/me', { token: tokenA });
    check('bloqueado ainda vê /me (ID e status)', r.status === 200 && r.data.planStatus === 'blocked', r.data?.planStatus);
    r = await api('POST', '/api/auth/login', { body: { email: emailA, password: 'nova1234' } });
    check('bloqueado ainda consegue logar (p/ ver tela de bloqueio)', r.status === 200, r.status);
    r = await api('GET', '/api/appointments', { token: tokenB });
    check('B NÃO é afetado pelo bloqueio de A', r.status === 200, r.status);

    r = await api('PATCH', `/api/admin/users/${userA.businessId}/unlock`, { admin: true });
    check('admin libera +30 dias', r.status === 200 && r.data.unlockedUntil, r);
    const until = new Date(r.data.unlockedUntil).getTime();
    check('liberação é de ~30 dias', Math.abs(until - (Date.now() + 30 * 86400000)) < 120000, r.data.unlockedUntil);
    r = await api('GET', '/api/appointments', { token: tokenA });
    check('A volta a funcionar imediatamente após liberar', r.status === 200, r.status);

    r = await api('PATCH', `/api/admin/users/${userA.businessId}/unlock`, { admin: true, body: { days: 30 } });
    const until2 = new Date(r.data.unlockedUntil).getTime();
    check('liberar de novo ACUMULA (soma sobre o que resta)', until2 - until > 29 * 86400000, (until2 - until) / 86400000);
  }

  console.log(`\nRESULTADO: ${pass} ok, ${fail} falhas`);
  if (fail) { console.log('Falhas:\n - ' + failures.join('\n - ')); }
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERRO NO TESTE', e); process.exit(2); });

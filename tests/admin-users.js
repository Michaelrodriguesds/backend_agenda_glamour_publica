// Teste ponta a ponta (servidor + banco REAIS de teste): excluir usuário inativo
// e senha temporária. Cria contas de teste — use SEMPRE um banco de teste.
// Uso:  BASE=http://localhost:5000 ADMIN_KEY=suachave node tests/admin-users.js
const B = process.env.BASE || "http://localhost:5000";
const AK = process.env.ADMIN_KEY;
const j = async (m, u, b, h = {}) => {
  const r = await fetch(B + u, { method: m, headers: { "Content-Type": "application/json", ...h }, body: b ? JSON.stringify(b) : undefined });
  let d; try { d = await r.json(); } catch {} return { s: r.status, d };
};
let ok = 0, f = 0;
const c = (n, x) => { x ? ok++ : f++; console.log(x ? "  ok  " : "  FAIL", n); };

(async () => {
  if (!AK) { console.log("Defina ADMIN_KEY"); process.exit(1); }
  const adm = { "x-admin-key": AK };
  const t = Date.now();
  const mk = async (tag) => {
    const email = `${tag}${t}@teste.com`;
    const reg = await j("POST", "/api/auth/register", { email, password: "abc12345", businessName: "Studio " + tag, locations: ["Centro"] });
    return { email, auth: { Authorization: "Bearer " + reg.d.token }, id: reg.d.user?.businessId || reg.d.businessId };
  };
  const A = await mk("a"), Bz = await mk("b");
  const tomorrow = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
  const fill = async (u, nome) => {
    await j("POST", "/api/appointments", { clientName: nome, procedures: ["Cílios"], date: tomorrow, time: "09:00", location: "Centro", price: 100 }, u.auth);
    await j("POST", "/api/notes", { title: "nota " + nome, content: "x" }, u.auth);
    await j("POST", "/api/feedback", { message: "relato de " + nome + " para teste" }, u.auth);
  };
  await fill(A, "Cliente A"); await fill(Bz, "Cliente B");
  if (!A.id) { const l = await j("GET", "/api/admin/users?search=" + encodeURIComponent(A.email), null, adm); A.id = l.d.data[0].businessId; }
  if (!Bz.id) { const l = await j("GET", "/api/admin/users?search=" + encodeURIComponent(Bz.email), null, adm); Bz.id = l.d.data[0].businessId; }
  c("duas contas criadas com ID", !!A.id && !!Bz.id);

  // ── senha temporária
  let r = await j("PATCH", `/api/admin/users/${A.id}/reset-password`);
  c("senha temporária sem chave = 401", r.s === 401);
  r = await j("PATCH", `/api/admin/users/${A.id}/reset-password`, null, adm);
  const temp = r.d?.tempPassword;
  c("admin gera senha temporária", r.s === 200 && /^[A-Za-z2-9]{10}$/.test(temp || ""));
  r = await j("POST", "/api/auth/login", { email: A.email, password: "abc12345" });
  c("senha antiga deixa de valer (401)", r.s === 401);
  r = await j("POST", "/api/auth/login", { email: A.email, password: temp });
  c("login com a senha temporária funciona", r.s === 200 && !!r.d.token);
  A.auth = { Authorization: "Bearer " + r.d.token };
  r = await j("PATCH", `/api/admin/users/ZZZZ9999/reset-password`, null, adm);
  c("ID inexistente = 404", r.s === 404);

  // ── exclusão
  r = await j("DELETE", `/api/admin/users/${A.id}?confirm=${A.id}`);
  c("excluir sem chave = 401", r.s === 401);
  r = await j("DELETE", `/api/admin/users/${A.id}?confirm=${A.id}`, null, adm);
  c("usuário ATIVO não pode ser excluído (409)", r.s === 409);
  r = await j("PATCH", `/api/admin/users/${A.id}/block`, null, adm);
  c("admin bloqueia", r.s === 200);
  r = await j("DELETE", `/api/admin/users/${A.id}`, null, adm);
  c("sem confirmação = 400", r.s === 400);
  r = await j("DELETE", `/api/admin/users/${A.id}?confirm=XXXX0000`, null, adm);
  c("confirmação errada = 400", r.s === 400);
  r = await j("GET", `/api/admin/users/${A.id}`, null, adm);
  c("nada foi excluído até aqui", r.s === 200);

  r = await j("DELETE", `/api/admin/users/${A.id}?confirm=${A.id}`, null, adm);
  c("bloqueado + confirmação certa = excluído", r.s === 200 && r.d.apagados.agendamentos >= 1 && r.d.apagados.notas >= 1 && r.d.apagados.relatos >= 1);
  r = await j("GET", `/api/admin/users/${A.id}`, null, adm);
  c("usuário some do admin (404)", r.s === 404);
  r = await j("POST", "/api/auth/login", { email: A.email, password: temp });
  c("não consegue mais entrar (401)", r.s === 401);
  r = await j("GET", "/api/appointments", null, A.auth);
  c("token antigo deixa de funcionar (401)", r.s === 401);

  // ── o outro negócio ficou intacto
  r = await j("GET", `/api/admin/users/${Bz.id}`, null, adm);
  c("outro negócio continua existindo", r.s === 200);
  r = await j("GET", "/api/appointments", null, Bz.auth);
  const lista = r.d?.data || r.d?.appointments || r.d || [];
  c("agendamentos do outro negócio intactos", r.s === 200 && JSON.stringify(lista).includes("Cliente B"));
  r = await j("GET", "/api/notes", null, Bz.auth);
  c("notas do outro negócio intactas", r.s === 200 && JSON.stringify(r.d).includes("nota Cliente B"));
  r = await j("GET", "/api/admin/feedback", null, adm);
  const fbs = r.d?.data || [];
  c("relato do outro negócio intacto e o do excluído sumiu",
    fbs.some((x) => x.email === Bz.email) && !fbs.some((x) => x.email === A.email));

  // e-mail liberado para novo cadastro
  r = await j("POST", "/api/auth/register", { email: A.email, password: "abc12345", businessName: "Novo", locations: ["Centro"] });
  c("e-mail excluído pode se cadastrar de novo", r.s === 201 || r.s === 200);

  console.log(`\n${ok} ok, ${f} falhas`);
  process.exit(f ? 1 : 0);
})();

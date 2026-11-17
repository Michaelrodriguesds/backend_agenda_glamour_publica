// Teste ponta a ponta (servidor + banco REAIS de teste) de relatos e aviso.
// Uso:  BASE=http://localhost:5000 ADMIN_KEY=suachave node tests/feedback.js
// Use SEMPRE um banco de teste: o script cria uma conta e um relato.
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
  const email = "fb" + Date.now() + "@teste.com";
  const reg = await j("POST", "/api/auth/register", { email, password: "abc12345", businessName: "Studio Teste", locations: ["Centro"] });
  const auth = { Authorization: "Bearer " + reg.d.token };

  // relatos
  let r = await j("POST", "/api/feedback", { type: "bug", message: "O botão salvar não responde" }, auth);
  c("usuário envia relato (201)", r.s === 201);
  r = await j("POST", "/api/feedback", { message: "oi" }, auth);
  c("relato curto = 400", r.s === 400);
  r = await j("POST", "/api/feedback", { message: "sem login" });
  c("sem login = 401", r.s === 401);

  r = await j("GET", "/api/admin/feedback?status=novo", null, adm);
  const mine = (r.d.data || []).find((x) => x.email === email);
  c("admin vê o relato com negócio e ID", r.s === 200 && mine && mine.negocio === "Studio Teste" && mine.tipo === "bug" && !!mine.businessId);
  r = await j("GET", "/api/admin/feedback", null);
  c("admin sem chave = 401", r.s === 401);

  r = await j("PATCH", `/api/admin/feedback/${mine.id}`, { status: "resolvido" }, adm);
  c("admin marca como resolvido", r.s === 200 && r.d.status === "resolvido");
  r = await j("DELETE", `/api/admin/feedback/${mine.id}`, null, adm);
  c("admin apaga", r.s === 200);

  // aviso
  r = await j("PUT", "/api/admin/announcement", { active: false, type: "info", message: "" }, adm);
  c("desliga aviso", r.s === 200 && r.d.active === false);
  r = await j("GET", "/api/status");
  c("público: sem aviso = null (sem login)", r.s === 200 && r.d.announcement === null);

  r = await j("PUT", "/api/admin/announcement", { active: true, type: "maintenance", message: "Manutenção hoje às 22h" }, adm);
  c("admin liga aviso", r.s === 200 && r.d.active === true);
  r = await j("GET", "/api/status");
  c("público vê o aviso na hora", r.d.announcement && r.d.announcement.message === "Manutenção hoje às 22h" && r.d.announcement.type === "maintenance");
  r = await j("PUT", "/api/admin/announcement", { active: true, message: "" }, adm);
  c("ligar sem mensagem = 400", r.s === 400);

  r = await j("PUT", "/api/admin/announcement", { active: false, type: "maintenance", message: "Manutenção hoje às 22h" }, adm);
  r = await j("GET", "/api/status");
  c("desligado: some para todos", r.d.announcement === null);

  console.log(`\n${ok} ok, ${f} falhas`);
  process.exit(f ? 1 : 0);
})();

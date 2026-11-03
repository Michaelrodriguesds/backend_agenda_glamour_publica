// ── Envio de e-mail via Resend (https://resend.com) ────────────────
// Grátis até 3.000 e-mails/mês. Variáveis:
//   RESEND_API_KEY  → chave da API (dashboard do Resend)
//   EMAIL_FROM      → remetente. Com "onboarding@resend.dev" o Resend só entrega
//                     para o e-mail da SUA conta Resend (modo de teste). Para
//                     enviar a qualquer cliente, verifique um domínio seu no
//                     Resend e use algo como "BelaAgenda <contato@seudominio.com>".
// Node 18+ já tem `fetch` global.

async function sendEmail({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || "BelaAgenda <onboarding@resend.dev>";

  if (!apiKey) {
    // Sem chave (dev local): não derruba o fluxo, só avisa no log.
    console.warn("⚠️  RESEND_API_KEY não configurada — e-mail NÃO enviado. Conteúdo:");
    console.warn({ to, subject, html });
    return { skipped: true };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject, html }),
    signal: AbortSignal.timeout(10000), // nunca fica pendurado esperando o Resend
  });

  if (!response.ok) {
    throw new Error(`Resend respondeu ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

async function sendResetCodeEmail(to, code) {
  return sendEmail({
    to,
    subject: "Código para redefinir sua senha",
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>Redefinição de senha</h2>
        <p>Use o código abaixo para redefinir sua senha. Ele expira em 15 minutos.</p>
        <p style="font-size: 32px; font-weight: bold; letter-spacing: 4px;">${code}</p>
        <p>Se você não pediu isso, pode ignorar este e-mail.</p>
      </div>
    `,
  });
}

module.exports = { sendEmail, sendResetCodeEmail };

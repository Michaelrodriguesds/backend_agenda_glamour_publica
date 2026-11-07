// ── Regras da aba "Clientes & Marketing" ─────────────────────────
// Os prazos de RETORNO de cada serviço NÃO ficam aqui: cada negócio
// configura os seus em "Meu negócio → Serviços → Dias para retorno"
// (campo businessConfig.services[].returnDays). Serviço com 0 dias não
// gera lembrete de retorno.
//
// Abaixo ficam só as regras gerais, iguais para todos os negócios.
module.exports = {
  TIMEZONE:           "America/Sao_Paulo",
  RETURN_WINDOW_DAYS: 14,  // depois do prazo, aparece por até 14 dias; depois vira "sumida"
  INACTIVE_DAYS:      60,  // "sumida": última visita há mais de 60 dias e nada marcado
  NEW_DAYS:           30,  // "nova": primeira visita nos últimos 30 dias
  LOYAL_DAYS:         180, // "fiéis": visitas nos últimos 6 meses
  LOYAL_MIN_VISITS:   2,   // precisa de pelo menos 2 visitas no período
  LOYAL_TOP:          10,  // mostra as 10 melhores
  MOVEMENT_DAYS:      90,  // gráfico de movimento: últimos 90 dias
};

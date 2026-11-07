// Variáveis usadas SÓ nos testes automáticos. Nunca apontam para um banco
// real nem usam segredos de produção: os testes simulam o Mongoose e não
// abrem conexão com o MongoDB.
process.env.JWT_SECRET         = "test-secret-not-used-in-production";
process.env.JWT_EXPIRES_IN     = "1h";
process.env.NODE_ENV           = "test";
process.env.DISABLE_RATE_LIMIT = "1";

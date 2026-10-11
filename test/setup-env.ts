// Guarda dos testes: nunca falar com o Asaas real, mesmo que o `.env` local aponte para ele
// (o Prisma carrega o `.env` ao importar o client, sem sobrescrever variáveis já definidas).
process.env.PAYMENT_GATEWAY = 'simulated';
delete process.env.ASAAS_API_KEY;
delete process.env.ASAAS_WEBHOOK_TOKEN;

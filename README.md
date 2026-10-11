# apuracaobrutal-backend

Backend NestJS do **Apuração Brutal** — monólito modular com arquitetura hexagonal pragmática e
PostgreSQL (Prisma). Specs, regras e arquitetura ficam no repositório raiz `apuracaobrutal-infra`
(`../specs/`, `../ai/module_map.md`).

Stack completa no Docker, Postgres local, portas e migrations via `make`: ver
["Rodando localmente"](../README.md#rodando-localmente) no repositório raiz.

## Pré-requisitos

- Node.js 24 LTS (`sudo n 24`)
- npm
- PostgreSQL acessível em `DATABASE_URL` (só para os comandos do Prisma; o `/ping` não usa o banco)

## Configuração

```bash
cp .env.example .env
npm install
```

| Variável | Padrão | Descrição |
|---|---|---|
| `NODE_ENV` | `development` | Fora de `production`, monta o Swagger em `/docs` |
| `PORT` | `3433` | Porta HTTP |
| `DATABASE_URL` | — | Conexão do PostgreSQL |
| `CORS_ORIGINS` | `http://localhost:3100` | Origens do navegador aceitas, separadas por vírgula (`*` é ignorado) |
| `TSE_*`, `ELECTION_*`, `SOURCE_STALE_AFTER_SECONDS`, `FEED_REFRESH_MS`, `SSE_MAX_CLIENTS` | ver `.env.example` | Eleição acompanhada e feed ([spec election-results-feed FR-01](../specs/election-results-feed/spec.md)) |
| `PAYMENT_GATEWAY`, `SPONSORSHIP_*`, `ASAAS_*` | ver `.env.example` | Patrocínios e pagamento ([sponsorships FR-01](../specs/sponsorships/spec.md), [asaas-payment FR-01](../specs/asaas-payment/spec.md)) |
| `SPONSORSHIP_MODERATION`, `ANTHROPIC_*`, `SPONSORSHIP_MODERATION_*` | ver `.env.example` | Moderação automática das imagens ([sponsorship-image-moderation FR-01](../specs/sponsorship-image-moderation/spec.md)); ver seção abaixo |

## Rodar

```bash
npm run start:dev    # hot reload
npm run build && npm run start:prod
```

- Health check: `GET http://localhost:3433/ping` → `pong` (ou `requests/ping.http`)
- Feed da apuração: `GET http://localhost:3433/election-feed` e SSE em `/election-feed/stream`
  (`requests/election-feed.http`)

### Worker

O runtime `worker` consulta os arquivos assinados do TSE e grava no Postgres; o backend só lê o banco.

```bash
npm run start:worker:dev   # hot reload (ou `make worker` na raiz)
npm run build && npm run start:worker
```
- Swagger (só desenvolvimento): `http://localhost:3433/docs`

### Moderação automática de imagens

Toda imagem de patrocínio é analisada pelo **worker** antes de poder ser paga e exibida
([spec sponsorship-image-moderation](../specs/sponsorship-image-moderation/spec.md); regras em
[rules.md](../specs/sponsorship-image-moderation/rules.md)). Não há revisão humana.

- **Chave da API**: `ANTHROPIC_API_KEY` fica só no `.env` do worker. O backend HTTP não a lê e
  sobe sem ela. Nunca versionar nem logar.
- **`SPONSORSHIP_MODERATION=simulated`** aprova tudo após 1 s, sem chamar a API — só para
  desenvolvimento local sem chave. Com `NODE_ENV=production` o worker **não sobe** com esse valor.
- **Modelo e custo**: `ANTHROPIC_MODERATION_MODEL` (padrão `claude-opus-5-5`), `ANTHROPIC_MODERATION_EFFORT`,
  `ANTHROPIC_TIMEOUT_MS`, `SPONSORSHIP_MODERATION_MAX_ATTEMPTS`, `SPONSORSHIP_MODERATION_MIN_CONFIDENCE`
  e `SPONSORSHIP_MODERATION_MAX_PER_HOUR` (teto global de chamadas por hora) — detalhes no
  `.env.example`.
- **Auditoria**: cada tentativa fica em `sponsorship_moderation_record` (decisão do modelo,
  categorias, motivos, texto lido, confiança, regras determinísticas acionadas, erro, `request_id`,
  latência e tokens). Nunca contém a chave nem dados do anunciante. Consultas úteis:

```sql
-- Decisões por dia
SELECT date_trunc('day', created_at) AS dia, outcome, count(*)
FROM sponsorship_moderation_record GROUP BY 1, 2 ORDER BY 1 DESC;
-- Tokens (custo) por modelo nos últimos 7 dias
SELECT model, sum(input_tokens) AS entrada, sum(output_tokens) AS saida, count(*) AS chamadas
FROM sponsorship_moderation_record
WHERE created_at > now() - interval '7 days' AND provider = 'claude' GROUP BY model;
-- Falhas por código e latência média
SELECT error_code, count(*), round(avg(latency_ms)) AS latencia_ms
FROM sponsorship_moderation_record GROUP BY error_code ORDER BY 2 DESC;
-- Por que um pedido foi recusado
SELECT attempt, outcome, model_decision, categories, rejection_rules, confidence, reasons
FROM sponsorship_moderation_record WHERE sponsorship_id = '<id>' ORDER BY attempt;
```

- **Calibração do limite de confiança** (spec AC-22): com a chave real, envie pelo menos 10
  imagens comerciais legítimas e 10 proibidas (uma por categoria quando possível) pela página
  `/sponsor`, leia `confidence` e `outcome` na tabela acima e confirme que `0.85` não aprova
  nenhuma proibida; se aprovações legítimas ficarem abaixo do limite, ajuste
  `SPONSORSHIP_MODERATION_MIN_CONFIDENCE` e anote o resultado na spec.

## Testes e lint

```bash
npm test           # unitários
npm run test:e2e   # HTTP (Supertest)
npm run test:int   # integração com o Postgres local (make infra + make migrate-deploy)
npm run lint       # ESLint com --fix
```

## Prisma

```bash
npm run prisma:generate
npm run prisma:migrate -- --name <mudança>   # dev
npm run prisma:deploy
npm run prisma:reset                         # só dev, destrói dados
npm run prisma:status
```

O schema não tem modelos ainda; cada spec de feature adiciona os seus.

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
| `SPONSORSHIP_MODERATION`, `AWS_REGION`, `AWS_PROFILE`, `REKOGNITION_TIMEOUT_MS`, `SPONSORSHIP_MODERATION_*` | ver `.env.example` | Moderação automática das imagens ([sponsorship-image-moderation FR-01](../specs/sponsorship-image-moderation/spec.md)); ver seção abaixo |

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

- **Provedor**: Amazon Rekognition, três operações por tentativa — `DetectModerationLabels`
  (rótulos de conteúdo impróprio), `DetectText` (texto lido) e `RecognizeCelebrities` (pessoas
  públicas, comparadas só com os dois candidatos). O provedor não decide: o backend aplica a
  política determinística da [R-4](../specs/sponsorship-image-moderation/rules.md#r-4--política-determinística-de-decisão-backend).
  O que cada categoria cobre (e o que ficou sem cobertura) está na
  [R-1](../specs/sponsorship-image-moderation/rules.md#r-1--política-de-conteúdo-e-cobertura).
- **Credenciais**: só o worker. Em desenvolvimento, `AWS_PROFILE=puoro` (o Compose monta `~/.aws`
  do host **somente leitura** em `/home/node/.aws` dos workers; nativo, o `.env` do backend aponta
  o profile e o SDK lê o `~/.aws` do usuário). Em produção, IAM role do serviço com
  `rekognition:DetectModerationLabels`, `rekognition:DetectText` e
  `rekognition:RecognizeCelebrities` — sem chave estática. O backend HTTP não lê credenciais e sobe
  sem elas. Credencial ausente ou sem permissão aparece como `provider_rejected` na auditoria.
- **`SPONSORSHIP_MODERATION=simulated`** aprova tudo após 1 s, sem chamar a API — só para
  desenvolvimento local sem credenciais. Com `NODE_ENV=production` o worker **não sobe** com esse valor.
- **Variáveis**: `AWS_REGION` (padrão `us-east-1`), `AWS_PROFILE`, `REKOGNITION_TIMEOUT_MS`,
  `SPONSORSHIP_MODERATION_LABEL_MIN_CONFIDENCE` (padrão 60), `SPONSORSHIP_MODERATION_CELEBRITY_MIN_CONFIDENCE`
  (padrão 90), `SPONSORSHIP_MODERATION_MAX_ATTEMPTS` e `SPONSORSHIP_MODERATION_MAX_PER_HOUR` (teto
  global de tentativas por hora) — detalhes no `.env.example`.
- **Auditoria**: cada tentativa fica em `sponsorship_moderation_record` (sinais normalizados em
  `signals`: rótulos com confiança, tipos de conteúdo, linhas de texto, contagem de palavras,
  saturação e pessoas reconhecidas; categorias, motivos gerados, texto lido, confiança, regras
  acionadas, erro, `request_id`, latência). Nunca contém credenciais nem dados do anunciante.
  Registros antigos com `provider = 'claude'` (v1) permanecem. Consultas úteis:

```sql
-- Decisões por dia
SELECT date_trunc('day', created_at) AS dia, outcome, count(*)
FROM sponsorship_moderation_record GROUP BY 1, 2 ORDER BY 1 DESC;
-- Tentativas por provedor nos últimos 7 dias (custo = tentativas × 3 chamadas; preço na tabela da AWS)
SELECT provider, model, count(*) AS tentativas, round(avg(latency_ms)) AS latencia_ms
FROM sponsorship_moderation_record
WHERE created_at > now() - interval '7 days' GROUP BY provider, model;
-- Falhas por código e latência média
SELECT error_code, count(*), round(avg(latency_ms)) AS latencia_ms
FROM sponsorship_moderation_record GROUP BY error_code ORDER BY 2 DESC;
-- Por que um pedido foi recusado
SELECT attempt, outcome, categories, rejection_rules, confidence, reasons
FROM sponsorship_moderation_record WHERE sponsorship_id = '<id>' ORDER BY attempt;
-- Calibração (AC-23): confiança de cada rótulo devolvido × decisão
SELECT r.outcome, l->>'name' AS rotulo, round((l->>'confidence')::numeric) AS confianca
FROM sponsorship_moderation_record r, jsonb_array_elements(r.signals->'labels') l
ORDER BY rotulo, confianca DESC;
```

- **Calibração dos limiares** (spec AC-23): com credenciais reais, envie pelo menos 10 imagens
  comerciais legítimas e 10 proibidas (rótulos, texto eleitoral e rosto de candidato) pela página
  `/sponsor`, leia `signals`, `rejection_rules` e `outcome` com as consultas acima e confirme que os
  limiares 60 (rótulo) e 90 (rosto) não aprovam nenhuma proibida; se legítimas forem recusadas em
  excesso, ajuste `SPONSORSHIP_MODERATION_LABEL_MIN_CONFIDENCE` / `..._CELEBRITY_MIN_CONFIDENCE` e
  anote o resultado na spec.

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

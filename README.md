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

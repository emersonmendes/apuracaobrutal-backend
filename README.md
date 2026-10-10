# apuracaobrutal-backend

Backend NestJS do **Apuração Brutal** — monólito modular com arquitetura hexagonal pragmática e
PostgreSQL (Prisma). Specs, regras e arquitetura ficam no repositório raiz `apuracaobrutal-infra`
(`../specs/`, `../ai/module_map.md`).

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

## Rodar

```bash
npm run start:dev    # hot reload
npm run build && npm run start:prod
```

- Health check: `GET http://localhost:3433/ping` → `pong` (ou `requests/ping.http`)
- Swagger (só desenvolvimento): `http://localhost:3433/docs`

## Testes e lint

```bash
npm test           # unitários
npm run test:e2e   # HTTP (Supertest)
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

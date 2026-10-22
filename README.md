# LevaGo 2.0

Plataforma de entregas de encomendas para Quelimane. Este repositório tem:

- `api/`: a API (Hono na Vercel) e a base de dados Postgres no Neon. Os ficheiros privados ficam na própria base.
- `web/`: o site (PWA em React) com três áreas: Cliente (`/cliente`), Estafeta (`/estafeta`) e Admin (`/admin`).

A versão Android (APK) vem depois, com Capacitor, a partir do mesmo site.

## Regras principais

- Distância máxima de 15 km por estrada e peso máximo de 15 kg.
- Modalidades normal e expressa. Moeda MZN. Hora de Maputo.
- Estados da encomenda: AGUARDA_PAGAMENTO, PENDENTE_ATRIBUICAO, ATRIBUIDO, ACEITE, RECOLHIDO, EM_TRANSPORTE, ENTREGUE, e também CANCELADO, FALHA_ENTREGA, DEVOLUCAO_PENDENTE e DEVOLVIDO.
- Os pagamentos M-Pesa e e-Mola estão simulados até haver as APIs oficiais. Em staging existe o método "Pagamento de teste (simulado)".

## Publicar (Vercel e Neon)

A Vercel está ligada a este repositório e publica sozinha em cada envio para `main`. Há 2 projectos:

| Projecto Vercel | Pasta (Root Directory) | O que é |
| --- | --- | --- |
| `levago-api` | `api` | A API. Framework: Hono. |
| `levago` | `web` | O site. Framework: Vite. |

Variáveis de ambiente do projecto `levago-api` (Settings > Environment Variables):

- `DATABASE_URL`: o endereço "pooled" da base Neon `levago`. É um segredo: nunca o coloque no código.
- `ENVIRONMENT`: `staging` (ou `production` quando entrar em produção).
- `CORS_ORIGINS`: o endereço do site, por exemplo `https://levago.vercel.app`.
- `CRON_SECRET`: um texto aleatório. A Vercel usa-o para chamar a limpeza diária.
- `PAYMENTS_WEBHOOK_SECRET` (opcional): só quando houver um provedor de pagamentos real.

Variável do projecto `levago`: `VITE_API_URL` = o endereço da API, sem `/` no fim.

### Base de dados

As tabelas estão em `api/db/`. Para aplicar as migrações a uma base nova:

```bash
cd api
DATABASE_URL='postgres://...' npm run db:migrate   # tabelas
DATABASE_URL='postgres://...' npm run db:seed      # zona e tarifa de teste (só staging)
```

### Tarefas periódicas

A API cancela pedidos por pagar, expira subscrições e limpa dados antigos. Corre no máximo a cada 15 minutos, depois de um pedido, e também 1 vez por dia pelo agendador da Vercel (`api/vercel.json`).

## Primeiro administrador

1. Crie uma conta normal no site, em `/cliente/registo`.
2. Dê o papel de administrador a essa conta:

   ```bash
   cd api
   DATABASE_URL='postgres://...' npm run make-admin -- +258841234567
   ```

3. Entre em `/admin` com o mesmo telemóvel e palavra-passe.

## Desenvolvimento local

Precisa de Node 22.

```bash
npm install
cd api
cp .env.example .env.local   # DATABASE_URL de um Postgres local
npm run db:migrate
npm run db:seed
npm run dev                  # API em http://localhost:8787
```

Noutro terminal:

```bash
cd web
cp .env.example .env.local    # VITE_API_URL=http://localhost:8787
npm run dev                   # site em http://localhost:5173
```

Em ambiente `test` ou `staging`, o código SMS do registo aparece no ecrã. Em produção vai por SMS.

## Testes

```bash
cd api
npx vitest run        # regras de negócio
TEST_DATABASE_URL='postgres://postgres@localhost:5432/postgres' npm run test:e2e   # fluxo completo com uma base temporária
```

## Segurança

- Nunca coloque tokens ou chaves no código nem no repositório. Use apenas as variáveis de ambiente da Vercel.
- As palavras-passe usam PBKDF2. As sessões guardam só o hash do token.
- O PIN de pagamento nunca é guardado.
- Os estados finais da encomenda não mudam. Todas as acções do Admin ficam na auditoria.

## Pendências

- Integração real com M-Pesa e e-Mola.
- Provedor de SMS (variáveis `SMS_PROVIDER_URL` e `SMS_PROVIDER_KEY`).
- Servidor de rotas próprio (o OSRM público serve só para testes).
- Preços finais aprovados pela direcção (a tarifa actual é de teste).
- Versão APK com Capacitor.

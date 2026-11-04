# LevaGo 2.0

Plataforma de entregas de encomendas para Quelimane. Este repositório tem:

- `api/`: a API (Hono num Cloudflare Worker) e a base de dados Postgres no Neon. Os ficheiros privados ficam na própria base.
- `web/`: o site (PWA em React) com três áreas: Cliente (`/cliente`), Estafeta (`/estafeta`) e Admin (`/admin`).

A versão Android (APK) vem depois, com Capacitor, a partir do mesmo site.

## Regras principais

- Distância máxima de 15 km por estrada e peso máximo de 15 kg.
- Modalidades normal e expressa. Moeda MZN. Hora de Maputo.
- Estados da encomenda: AGUARDA_PAGAMENTO, PENDENTE_ATRIBUICAO, ATRIBUIDO, ACEITE, RECOLHIDO, EM_TRANSPORTE, ENTREGUE, e também CANCELADO, FALHA_ENTREGA, DEVOLUCAO_PENDENTE e DEVOLVIDO.
- Os pagamentos M-Pesa e e-Mola estão simulados até haver as APIs oficiais. Em staging existe o método "Pagamento de teste (simulado)".

## Publicar (Cloudflare e Neon)

A API corre num Cloudflare Worker (`levago-api`) e o site no Cloudflare Pages (`levago`). A base de dados é o Postgres no Neon.
Pode publicar sozinho pelo GitHub em cada envio para `main`, ou à mão no painel da Cloudflare. Os passos estão em [docs/CLOUDFLARE.md](docs/CLOUDFLARE.md).

### Base de dados

As tabelas estão em `api/db/`. Para aplicar as migrações a uma base nova:

```bash
cd api
DATABASE_URL='postgres://...' npm run db:migrate   # tabelas
DATABASE_URL='postgres://...' npm run db:seed      # zona e tarifa de teste (só staging)
```

### Tarefas periódicas

A API cancela pedidos por pagar, expira subscrições e limpa dados antigos. Na Cloudflare corre a cada 15 minutos pelo agendador do Worker (`api/wrangler.toml`).

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

- Nunca coloque tokens ou chaves no código nem no repositório. Use apenas os segredos do GitHub e da Cloudflare.
- As palavras-passe usam PBKDF2. As sessões guardam só o hash do token.
- O PIN de pagamento nunca é guardado.
- Os estados finais da encomenda não mudam. Todas as acções do Admin ficam na auditoria.

## Pendências

- Integração real com M-Pesa e e-Mola.
- Provedor de SMS (variáveis `SMS_PROVIDER_URL` e `SMS_PROVIDER_KEY`).
- Servidor de rotas próprio (o OSRM público serve só para testes).
- Preços finais aprovados pela direcção (a tarifa actual é de teste).
- Versão APK com Capacitor.

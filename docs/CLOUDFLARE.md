# Publicar o LevaGo na Cloudflare

O LevaGo tem 2 partes na Cloudflare (conta `e05eeae53ace56c96df2f49e36c750a5`):

| Nome | Tipo | O que é |
| --- | --- | --- |
| `levago-api` | Worker | A API. A base de dados continua no Neon (Postgres). |
| `levago` | Pages | O site (Cliente, Estafeta e Admin). A APK abre este site. |

O site `levago` também tem a API dentro dele, em `/v1` (pasta `functions/`). Assim o site e a API usam o mesmo endereço, por exemplo `https://levago.pages.dev/v1/config`. O Worker `levago-api` só é preciso para a publicação manual pelo painel.

## 0. Projecto Pages ligado ao GitHub (o mais simples)

1. Cloudflare > Workers & Pages > Create > Pages > Connect to Git > repositório `Leva-Go-2.0`. Nome do projecto: `levago`.
2. Production branch: `main`. Framework preset: `None`.
3. Build command: `npm run build`. Build output directory: `web/dist`. Root directory: deixe vazio.
4. Save and Deploy.
5. Depois, em Settings > Variables and Secrets, junte os segredos (tipo Secret) `DATABASE_URL` e `RESEND_API_KEY`. Faça Retry deployment.

As definições `nodejs_compat`, `ENVIRONMENT` e `CORS_ORIGINS` vêm do ficheiro `wrangler.toml` na raiz.

Há mais 2 formas de publicar. Pode usar todas.

## 1. Publicação automática (GitHub)

Em cada envio para `main`, o GitHub publica a API e o site sozinho (`.github/workflows/cloudflare.yml`).
Também pode correr à mão: GitHub > Actions > Cloudflare > Run workflow.

Configurar 1 vez, em GitHub > Settings > Secrets and variables > Actions > Secrets:

1. `CLOUDFLARE_API_TOKEN`: crie em Cloudflare > My Profile > API Tokens > Create Token > modelo "Edit Cloudflare Workers". Junte a permissão "Cloudflare Pages: Edit".
2. `DATABASE_URL`: o endereço "pooled" da base Neon `levago` (está no painel do Neon: Connection string, opção "Pooled connection").
3. `RESEND_API_KEY`: a chave do Resend para os e-mails com códigos.
4. `CRON_SECRET` (opcional): um texto aleatório para chamar a limpeza à mão.

Sem `CLOUDFLARE_API_TOKEN`, o GitHub não publica nada: só gera os pacotes da secção 2.

## 2. Publicação manual (painel da Cloudflare)

Cada execução do workflow "Cloudflare" gera 2 pacotes. Abra a execução em GitHub > Actions > Cloudflare e desça até "Artifacts":

- `levago-site`: a pasta do site, já pronta.
- `levago-api`: o ficheiro `worker.js` da API.

Para gerar os pacotes sem publicar: Run workflow, desmarque "Publicar já", e carregue em Run.

Atenção: o site precisa de saber o endereço da API. Se a publicação automática estiver desligada, crie a variável `LEVAGO_API_URL` em GitHub > Settings > Secrets and variables > Actions > Variables (por exemplo `https://levago-api.SEU-NOME.workers.dev`, sem `/` no fim).

### Subir o site

1. Descarregue `levago-site` e descomprima.
2. Cloudflare > Workers & Pages > `levago` > Create deployment (na primeira vez: Create > Pages > Upload assets, nome `levago`).
3. Arraste a pasta descomprimida e carregue em Deploy.

### Subir a API

1. Descarregue `levago-api` e descomprima: fica o ficheiro `worker.js`.
2. Cloudflare > Workers & Pages > `levago-api` > Edit code (na primeira vez: Create > Worker > nome `levago-api` > Deploy, e depois Edit code).
3. Apague o código que lá está, cole o conteúdo de `worker.js` e carregue em Deploy.

Na primeira vez, configure também o Worker `levago-api` em Settings:

- Runtime > Compatibility flags: `nodejs_compat`. Compatibility date: `2025-09-01`.
- Variables and Secrets:
  - `ENVIRONMENT` = `production`
  - `CORS_ORIGINS` = o endereço do site, por exemplo `https://levago.pages.dev`
  - `DATABASE_URL` (tipo Secret) = endereço "pooled" do Neon
  - `RESEND_API_KEY` (tipo Secret)
- Triggers > Cron Triggers: `*/15 * * * *` (limpeza a cada 15 minutos).

A publicação automática repõe `ENVIRONMENT`, `CORS_ORIGINS`, o cron e as flags a partir de `api/wrangler.toml`. Os segredos nunca são apagados.

## Publicar a partir do computador

Com Node 22, na pasta do projecto:

```bash
npm install
npx --prefix api wrangler login
npm run deploy:api
npm run deploy:site
```

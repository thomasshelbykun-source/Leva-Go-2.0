# LevaGo 2.0

Plataforma de entregas de encomendas para Quelimane. Este repositório tem:

- `api/`: a API (Cloudflare Workers com Hono), a base de dados D1 e os ficheiros privados no R2.
- `web/`: o site (PWA em React) com três áreas: Cliente (`/cliente`), Estafeta (`/estafeta`) e Admin (`/admin`).

A versão Android (APK) vem depois, com Capacitor, a partir do mesmo site.

## Regras principais

- Distância máxima de 15 km por estrada e peso máximo de 15 kg.
- Modalidades normal e expressa. Moeda MZN. Hora de Maputo.
- Estados da encomenda: AGUARDA_PAGAMENTO, PENDENTE_ATRIBUICAO, ATRIBUIDO, ACEITE, RECOLHIDO, EM_TRANSPORTE, ENTREGUE, e também CANCELADO, FALHA_ENTREGA, DEVOLUCAO_PENDENTE e DEVOLVIDO.
- Os pagamentos M-Pesa e e-Mola estão simulados até haver as APIs oficiais. Em staging existe o método "Pagamento de teste (simulado)".

## Publicar no Cloudflare

Os testes correm sozinhos em cada envio (`.github/workflows/ci.yml`). A publicação não corre sozinha: faz-se à mão, um passo de cada vez (`.github/workflows/deploy.yml`).

Preparar uma vez:

1. No Cloudflare, crie um API Token com estas permissões em modo Edit: Workers Scripts, D1, Workers R2 Storage e Cloudflare Pages. Junte Account Settings em modo Read.
2. No GitHub, abra Settings > Secrets and variables > Actions e crie estes segredos:
   - `CLOUDFLARE_API_TOKEN`: o token do passo 1.
   - `CLOUDFLARE_ACCOUNT_ID`: o Account ID (aparece no painel do Cloudflare, à direita).
   - `PAYMENTS_WEBHOOK_SECRET` (opcional): só quando houver um provedor de pagamentos real.

Publicar: abra Actions > Publicar no Cloudflare > Run workflow e escolha um passo. Siga esta ordem:

1. `1-base-de-dados`: cria a base D1 `levago`, aplica as migrações e, na primeira vez, carrega as zonas e a tarifa de teste.
2. `2-armazenamento`: cria o armazenamento R2 `levago-files` para fotos e documentos.
3. `3-api`: publica a API em `https://levago-api.<subdomínio>.workers.dev`.
4. `4-site`: publica o site no Cloudflare Pages (projecto `levago`). Depois, corra outra vez o passo `3-api` para a API aceitar pedidos do endereço do site.

Cada passo pode ser repetido sem estragar o que já existe. O resumo da execução mostra os endereços. Para usar outro nome no Pages, crie a variável `PAGES_PROJECT` em Settings > Secrets and variables > Actions > Variables.

### Conta de teste e conta verdadeira

Pode publicar primeiro numa conta Cloudflare de teste. Para passar à conta verdadeira, troque os dois segredos e corra os passos outra vez. Os dados da conta de teste (contas, encomendas, estafetas) não passam para a conta verdadeira.

Nota: se a conta Cloudflare ainda não tiver um subdomínio workers.dev, abra Workers & Pages no painel uma vez para o activar.

## Primeiro administrador

1. Crie uma conta normal no site, em `/cliente/registo`.
2. No GitHub, abra Actions > Criar administrador > Run workflow e escreva o telemóvel no formato `+2588XXXXXXXX`.
3. Entre em `/admin` com o mesmo telemóvel e palavra-passe.

## Desenvolvimento local

Precisa de Node 22.

```bash
npm install
cd api
npx wrangler d1 migrations apply levago --local
npx wrangler d1 execute levago --local --file seed/staging.sql
npx wrangler dev --var ENVIRONMENT:test     # API em http://localhost:8787
```

Noutro terminal:

```bash
cd web
cp .env.example .env.local    # VITE_API_URL=http://localhost:8787
npm run dev                   # site em http://localhost:5173
```

Em ambiente `test` ou `staging`, o código SMS do registo aparece no ecrã. Em produção vai por SMS.

Para dar o papel de administrador a uma conta local:

```bash
cd api
bash scripts/make-admin.sh +258841234567
```

## Testes

```bash
cd api
npx vitest run        # regras de negócio
npm run test:e2e      # fluxo completo com D1 local
```

## Segurança

- Nunca coloque tokens ou chaves no código nem no repositório. Use apenas os segredos do GitHub e do Cloudflare.
- As palavras-passe usam PBKDF2. As sessões guardam só o hash do token.
- O PIN de pagamento nunca é guardado.
- Os estados finais da encomenda não mudam. Todas as acções do Admin ficam na auditoria.

## Pendências

- Integração real com M-Pesa e e-Mola.
- Provedor de SMS (variáveis `SMS_PROVIDER_URL` e `SMS_PROVIDER_KEY`).
- Servidor de rotas próprio (o OSRM público serve só para testes).
- Preços finais aprovados pela direcção (a tarifa actual é de teste).
- Versão APK com Capacitor.

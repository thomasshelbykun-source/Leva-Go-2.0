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

Os testes correm em cada envio para `main`. A publicação pelo GitHub Actions (`.github/workflows/deploy.yml`) só corre quando carrega em Run workflow. Também pode publicar pelo painel do Cloudflare, ligado ao repositório (ver `docs/publicar-manual-cloudflare.md`).

1. No Cloudflare, crie um API Token com estas permissões: Workers Scripts (Edit), D1 (Edit), Workers R2 Storage (Edit), Cloudflare Pages (Edit) e Account Settings (Read).
2. No GitHub, abra Settings > Secrets and variables > Actions e crie estes segredos:
   - `CLOUDFLARE_API_TOKEN`: o token do passo 1.
   - `CLOUDFLARE_ACCOUNT_ID`: o Account ID (aparece no painel do Cloudflare, à direita).
   - `PAYMENTS_WEBHOOK_SECRET` (opcional): só quando houver um provedor de pagamentos real.
3. Abra Actions > Testar e publicar > Run workflow.

O workflow faz isto:

1. Corre os testes da API e compila o site.
2. Cria a base D1 `levago` se não existir, aplica as migrações e, na primeira vez, carrega as zonas e a tarifa de teste.
3. Cria o armazenamento R2 `levago-files` se não existir.
4. Publica a API no endereço `https://levago-api.<subdomínio>.workers.dev`.
5. Publica o site no Cloudflare Pages (projecto `levago`). Para usar outro nome, crie a variável `PAGES_PROJECT` em Settings > Secrets and variables > Actions > Variables.

O resumo da execução mostra os endereços do site e da API.

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
npm run db:migrate:local
npm run db:seed:local
npm run dev                  # API em http://localhost:8787
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

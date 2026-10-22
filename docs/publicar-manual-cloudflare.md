# LevaGo 2.0: publicar pelo painel do Cloudflare

O Cloudflare liga-se ao repositório Leva-Go-2.0 e publica sozinho em cada envio para `main`. Não precisa de segredos no GitHub.

## Já está feito

- Base de dados D1 `levago` criada, com as tabelas, a zona de Quelimane e a tarifa de teste.
- O ID da base de dados já está no repositório (`api/wrangler.toml`).

## 1. API (Worker)

1. Abra **Workers & Pages > Create > Workers > Import a repository** e escolha **Leva-Go-2.0**.
2. Preencha:
   - Project name: `levago-api` (tem de ser exactamente este nome)
   - Root directory: `api`
   - Build command: deixe vazio
   - Deploy command: `npx wrangler deploy`
3. Clique em **Deploy** e espere até terminar.
4. Copie o endereço da API: `https://levago-api.<o-seu-nome>.workers.dev`.
5. Teste no navegador: `https://levago-api.<o-seu-nome>.workers.dev/v1/config`. Deve aparecer texto com `"company"`.

## 2. Site (Pages)

1. Abra **Workers & Pages > Create > Pages > Connect to Git** e escolha **Leva-Go-2.0**.
2. Preencha:
   - Project name: `levago`
   - Production branch: `main`
   - Framework preset: `None`
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Root directory: `web`
   - Environment variables: `VITE_API_URL` = o endereço da API do passo 1, sem `/` no fim.
3. Clique em **Save and Deploy**.
4. Copie o endereço do site, por exemplo `https://levago.pages.dev`. Se for outro endereço, envie-mo: tenho de o autorizar na API.

## 3. Primeiro administrador

1. Abra o site e crie uma conta em `/cliente/registo`.
2. Envie-me o telemóvel dessa conta. Eu dou-lhe o papel de administrador.
3. Entre em `/admin` com o mesmo telemóvel e palavra-passe.

## Armazenamento de ficheiros (R2), mais tarde

O R2 ainda não está activo na conta. Sem ele, o site funciona, mas os estafetas não conseguem enviar documentos nem fotos.

1. Abra **R2 Object Storage** e active o R2. O Cloudflare pode pedir um cartão, mesmo no plano gratuito.
2. Avise-me. Eu crio o bucket `levago-files` e ligo-o à API.

## Se algo falhar

Copie a mensagem do registo (Build log) e envie-ma.

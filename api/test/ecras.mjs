// Testes de ecrã: abre cada ecrã das três apps num browser real (Chromium) contra a API do teste e verifica:
// 1) o ecrã abre sem erro (sem caixa de erro e sem excepção JavaScript); 2) o ecrã mostra o conteúdo esperado.
// Também percorre a nova encomenda por bairros até à página de pagamento.
import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, mkdtempSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';

export const SCREEN_PORT = 8798;
export const SCREEN_ORIGIN = `http://127.0.0.1:${SCREEN_PORT}`;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };

/** Compila a app web a apontar para a API do teste e serve-a com recurso a index.html (SPA). */
function buildAndServe(apiUrl) {
  const out = mkdtempSync(join(tmpdir(), 'levago-web-'));
  const web = resolve(import.meta.dirname, '../../web');
  execFileSync('npx', ['vite', 'build', '--outDir', out, '--emptyOutDir'], { cwd: web, stdio: 'pipe', env: { ...process.env, VITE_API_URL: apiUrl } });
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, SCREEN_ORIGIN).pathname);
    let file = join(out, path);
    if (!file.startsWith(out) || !existsSync(file) || statSync(file).isDirectory()) file = join(out, 'index.html');
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  return new Promise((r) => server.listen(SCREEN_PORT, '127.0.0.1', () => r(server)));
}

export async function testarEcras(ctx) {
  const { ok, api, apiOrigin, cli, winner, adminToken, orderId, incidentId, subscriptionId, ticketId, payOrderId } = ctx;
  let chromium;
  try {
    chromium = createRequire(import.meta.url)('playwright').chromium;
  } catch {
    console.log('  (Playwright não está instalado: testes de ecrã ignorados)');
    return;
  }
  const server = await buildAndServe(apiOrigin);
  const browser = await chromium.launch();
  const tokens = { cliente: cli.token, estafeta: winner.token, admin: adminToken };

  /** Abre um ecrã com sessão iniciada e devolve a página aberta. */
  async function open(app, path) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.addInitScript(([k, t]) => localStorage.setItem(k, t), [`levago.${app}.token`, tokens[app]]);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(SCREEN_ORIGIN + path, { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    return { page, errors, context };
  }

  async function screen(app, path, expect, label) {
    const { page, errors, context } = await open(app, path);
    // Uma caixa de erro de carregamento tem o botão «Tentar de novo»; os avisos operacionais (ex.: falhas por resolver) não.
    const alerts = await page.locator('[role=alert]:has-text("Não foi possível concluir"), [role=alert]:has-text("Sem ligação"), [role=alert]:has-text("Sem permissão")').allInnerTexts();
    ok(errors.length === 0 && alerts.length === 0, `${label}: abre sem erro${errors.length || alerts.length ? ` (${[...errors, ...alerts].join(' | ').slice(0, 160)})` : ''}`);
    const body = await page.locator('body').innerText();
    const want = Array.isArray(expect) ? expect : [expect];
    const miss = want.filter((w) => !body.includes(w));
    ok(miss.length === 0, `${label}: mostra ${want.map((w) => `«${w}»`).join(', ')}${miss.length ? ` (falta ${miss.join(', ')})` : ''}`);
    await context.close();
  }

  try {
    console.log('Página inicial (sem sessão)');
    {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const page = await context.newPage();
      await page.goto(SCREEN_ORIGIN + '/', { waitUntil: 'networkidle' });
      ok(page.url().endsWith('/cliente/boas-vindas'), 'abrir o site sem sessão vai para a página inicial');
      const body = await page.locator('body').innerText();
      ok(body.includes('Criar conta') && body.includes('Entrar'), 'página inicial mostra Criar conta e Entrar');
      const dl = await page.getByRole('link', { name: 'Baixar a app Android' }).getAttribute('href');
      ok(dl === 'https://github.com/thomasshelbykun-source/Leva-Go-2.0/releases/download/apk-latest/LevaGo.apk', 'página inicial tem o link para baixar o APK');
      await page.goto(SCREEN_ORIGIN + '/estafeta/boas-vindas?app=android', { waitUntil: 'networkidle' });
      ok((await page.getByRole('link', { name: 'Baixar a app Android' }).count()) === 0, 'dentro da app Android o link para baixar não aparece');
      await context.close();
    }

    console.log('Manter sessão e voltar ao mesmo sítio');
    {
      // Abre o site com a sessão e a última página guardadas, como quem fechou a app sem querer.
      const reopen = async (store) => {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
        await context.addInitScript((entries) => {
          if (sessionStorage.getItem('t.done')) return;
          sessionStorage.setItem('t.done', '1');
          for (const [k, v] of entries) localStorage.setItem(k, v);
        }, Object.entries(store));
        const page = await context.newPage();
        await page.goto(SCREEN_ORIGIN + '/', { waitUntil: 'networkidle' });
        await page.waitForTimeout(300);
        return { page, context };
      };
      let r = await reopen({ 'levago.cliente.token': tokens.cliente, 'levago.ultima-pagina': '/cliente/encomendas' });
      ok(new URL(r.page.url()).pathname === '/cliente/encomendas', 'cliente volta à última página ao abrir o site');
      await r.context.close();
      r = await reopen({ 'levago.estafeta.token': tokens.estafeta });
      ok(new URL(r.page.url()).pathname.startsWith('/estafeta'), 'estafeta com sessão abre a app de estafeta (não a página inicial)');
      await r.context.close();
      r = await reopen({ 'levago.admin.token': tokens.admin, 'levago.ultima-pagina': '/admin' });
      ok(new URL(r.page.url()).pathname.startsWith('/admin'), 'admin volta ao painel ao abrir o site');
      await r.context.close();

      const draft = {
        saved: Date.now(), step: 'detalhes', est: { establishment_type: 'restaurante', establishment_name: '', order_ref: '', paid_confirmed: false },
        pickup: null, dropoff: null, otherWeight: false, d: { description: 'Livro guardado a meio' }, service: 'normal', when: 'agora', date: '2000-01-01',
      };
      r = await reopen({ 'levago.cliente.token': tokens.cliente, 'levago.ultima-pagina': '/cliente/nova', [`levago.cliente.rascunho.${cli.user.id}.envio`]: JSON.stringify(draft) });
      const body = await r.page.locator('body').innerText();
      const values = await r.page.locator('input, textarea').evaluateAll((els) => els.map((e) => e.value));
      ok(new URL(r.page.url()).pathname === '/cliente/nova' && body.includes('Continuámos o pedido'), 'pedido a meio: volta ao pedido e avisa');
      ok(values.includes('Livro guardado a meio'), 'pedido a meio: os dados escritos continuam lá');
      await r.context.close();
      r = await reopen({ 'levago.cliente.token': tokens.cliente, 'levago.ultima-pagina': '/cliente/nova', [`levago.cliente.rascunho.${cli.user.id}.envio`]: JSON.stringify({ ...draft, saved: Date.now() - 4 * 3_600_000 }) });
      ok(!(await r.page.locator('body').innerText()).includes('Continuámos o pedido'), 'pedido a meio com mais de 3 horas já não volta');
      await r.context.close();

      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const page = await context.newPage();
      await page.goto(SCREEN_ORIGIN + '/cliente/entrar', { waitUntil: 'networkidle' });
      const box = page.getByLabel('Manter sessão iniciada');
      ok((await box.count()) === 1 && (await box.isChecked()), 'Entrar mostra «Manter sessão iniciada», marcado por omissão');
      await context.close();
    }

    console.log('Ecrãs do Cliente');
    await screen('cliente', '/cliente', 'Início', 'Início');
    await screen('cliente', '/cliente/encomendas', 'Pedidos', 'Pedidos');
    await screen('cliente', `/cliente/encomendas/${orderId}`, 'Entregue', 'Acompanhar pedido');
    await screen('cliente', `/cliente/encomendas/${orderId}/comprovativo`, 'Comprovativo', 'Comprovativo');
    await screen('cliente', '/cliente/planos', 'Subscrição', 'Subscrição');
    await screen('cliente', '/cliente/notificacoes', 'Notificações', 'Notificações');
    await screen('cliente', '/cliente/perfil', 'Perfil', 'Perfil');
    await screen('cliente', '/cliente/apoio', 'Apoio', 'Apoio');
    await screen('cliente', '/cliente/ocorrencias', 'Ocorrências', 'Ocorrências');
    await screen('cliente', `/cliente/ocorrencias/${incidentId}`, 'A caixa chegou amassada', 'Detalhe da reclamação');
    await screen('cliente', `/cliente/pagar/${payOrderId}`, ['Pagamento', 'Como queres pagar?'], 'Pagamento da encomenda');

    console.log('Pagamento do plano (antes aparecia em branco)');
    await screen('cliente', `/cliente/pagar-plano/${subscriptionId}`, ['Pagamento', 'Plano '], 'Pagamento do plano');

    console.log('Nova encomenda por bairros (Locais, Encomenda, Serviço, Pagamento)');
    {
      const { page, errors, context } = await open('cliente', '/cliente/nova');
      const fields = page.getByPlaceholder('Escreve o nome do bairro');
      await fields.nth(0).fill('icid');
      ok(await page.getByRole('button', { name: 'Icídua' }).isVisible(), 'Locais: escrever parte do nome sem acento sugere «Icídua»');
      await page.getByRole('button', { name: 'Icídua' }).click();
      await fields.nth(1).fill('Bairro que não existe');
      ok(await page.getByText('Não encontrámos este bairro').isVisible(), 'Locais: bairro desconhecido mostra aviso');
      await fields.nth(1).fill('Coalane');
      await page.getByRole('button', { name: /Continuar/ }).first().click();
      ok(await page.getByText('Dados da encomenda').isVisible(), 'Encomenda: passo 2 abre depois dos bairros');
      const cont2 = page.getByRole('button', { name: 'Continuar' });
      ok(await cont2.isDisabled(), 'Encomenda: Continuar fica bloqueado sem os dados');
      await page.getByText('≤ 1 kg').click();
      await page.getByPlaceholder('Ex.: Envelope').fill('Documentos');
      await page.getByLabel('Nome de quem recebe').fill('Dino Destinatário');
      await page.getByLabel('Telemóvel de quem recebe').fill('843000001');
      await page.getByText('Declaro que o conteúdo').click();
      await cont2.click();
      ok(await page.getByText('Quando desejas a entrega?').isVisible() && await page.getByText('Tipo de entrega').isVisible(), 'Serviço: mostra quando e tipo de entrega');
      ok(await page.getByText('A previsão inclui a atribuição do estafeta').isVisible(), 'Serviço: mostra a nota da previsão');
      await page.getByRole('button', { name: 'Continuar' }).click();
      await page.getByText('Resumo').waitFor({ timeout: 15000 });
      const body = await page.locator('body').innerText();
      ok(body.includes('Icídua') && body.includes('Coalane'), 'Pagamento: resumo mostra os dois bairros');
      const confirmBtn = page.getByRole('button', { name: /Confirmar/ });
      const radios = page.locator('input[name="metodo"]');
      ok((await radios.count()) < 2 || (await confirmBtn.isDisabled()), 'Pagamento: com vários métodos, Confirmar espera pela escolha');
      if ((await radios.count()) > 0) await radios.last().check();
      ok(await confirmBtn.isEnabled(), 'Pagamento: Confirmar fica activo depois de escolher o método');
      await confirmBtn.click();
      await page.waitForURL(/\/cliente\/(pagar|encomendas)\//, { timeout: 15000 }).catch(() => {});
      await page.waitForLoadState('networkidle');
      ok(/\/cliente\/(pagar|encomendas)\//.test(page.url()), 'Confirmar cria o pedido e abre o pagamento');
      ok((await page.locator('body').innerText()).trim().length > 40 && errors.length === 0, 'página seguinte não fica em branco');
      await context.close();
    }

    console.log('Ecrãs do Estafeta');
    await screen('estafeta', '/estafeta', 'Online', 'Início do estafeta');
    await screen('estafeta', '/estafeta/historico', 'Histórico', 'Histórico');
    await screen('estafeta', '/estafeta/ganhos', 'Ganhos', 'Ganhos');
    await screen('estafeta', '/estafeta/veiculo', 'Veículo', 'Veículo');
    await screen('estafeta', '/estafeta/perfil', 'Perfil', 'Perfil do estafeta');
    await screen('estafeta', '/estafeta/notificacoes', 'Notificações', 'Notificações do estafeta');
    await screen('estafeta', '/estafeta/apoio', 'Apoio', 'Apoio do estafeta');

    console.log('Ecrãs do Admin');
    await screen('admin', '/admin', 'Painel', 'Painel');
    await screen('admin', '/admin/encomendas', 'Encomendas', 'Encomendas');
    await screen('admin', `/admin/encomendas/${orderId}`, 'Entregue', 'Detalhe da encomenda');
    await screen('admin', '/admin/clientes', 'Carla', 'Clientes');
    await screen('admin', `/admin/clientes/${cli.user.id}`, 'Carla', 'Ficha do cliente');
    await screen('admin', '/admin/estafetas', 'Estafeta', 'Estafetas');
    await screen('admin', `/admin/estafetas/${winner.user.id}`, winner.user.name.split(' ')[0], 'Ficha do estafeta');
    await screen('admin', '/admin/subscricoes', 'Planos', 'Subscrições');
    await screen('admin', '/admin/pagamentos', 'Pagamentos', 'Pagamentos');
    await screen('admin', '/admin/tarifas', 'Tarifas', 'Tarifas');
    await screen('admin', '/admin/zonas', ['Bairros', 'Coalane'], 'Zonas e bairros');
    await screen('admin', '/admin/seguranca', 'Segurança', 'Centro de segurança');
    await screen('admin', '/admin/suporte', 'Apoio', 'Apoio (tickets)');
    await screen('admin', `/admin/suporte/${ticketId}`, 'Dúvida sobre pagamento', 'Detalhe do ticket');
    await screen('admin', '/admin/relatorios', 'Relatórios', 'Relatórios');
    await screen('admin', '/admin/definicoes', 'Configurações do sistema', 'Definições');
    void api;
  } finally {
    await browser.close();
    server.close();
  }
}

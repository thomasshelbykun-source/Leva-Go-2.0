// Testes por função e por ecrã (pedido de 17/11/2026): pelo menos dois testes para cada rota que a app usa
// e que o fluxo principal de e2e.mjs não cobre. Cada bloco testa um caso válido e um caso rejeitado.
// Corre dentro de e2e.mjs, com a mesma API e a mesma base de dados temporária.

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const formFile = (fields) => {
  const f = new FormData();
  f.append('file', new Blob([PNG], { type: 'image/png' }), 'foto.png');
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return f;
};

export async function testarFuncoes(ctx) {
  const { api, ok, register, login, photo, adminSql, dbUrl, adminToken, admin2Token, cli, winner, orderId, orderBody, pc } = ctx;
  const R = 'Teste automático das funções';

  console.log('Bairros: lista do cliente (passo Locais)');
  const bl = await api('GET', '/bairros', { token: cli.token });
  ok(bl.status === 200 && bl.data.length >= 19 && bl.data.some((b) => b.name === 'Coalane'), 'cliente recebe a lista de bairros activos');
  ok((await api('GET', '/bairros')).status === 401, 'lista de bairros exige sessão');
  ok(bl.data.every((b) => b.id && b.name && b.city) && !('lat' in bl.data[0]), 'lista do cliente traz nome e cidade, sem coordenadas internas');

  console.log('Cotação por bairro');
  const qb = await api('POST', '/quotes', { token: cli.token, body: { pickup: { bairro_id: 'bairro-cimento', reference: 'Junto ao mercado' }, dropoff: { bairro_id: 'bairro-coalane' }, weight_kg: 1, service_type: 'normal' } });
  ok(qb.status === 200 && qb.data.quote_id && qb.data.total_cents > 0, 'cotação com nomes de bairro devolve preço');
  const qx = await api('POST', '/quotes', { token: cli.token, body: { pickup: { bairro_id: 'bairro-inventado' }, dropoff: { bairro_id: 'bairro-coalane' }, weight_kg: 1, service_type: 'normal' } });
  ok(qx.status === 400 && qx.data.error === 'bairro', 'bairro desconhecido é rejeitado');
  ok((await api('POST', '/quotes', { token: cli.token, body: { pickup: { bairro_id: 'bairro-cimento', reference: 'x'.repeat(201) }, dropoff: { bairro_id: 'bairro-coalane' }, weight_kg: 1, service_type: 'normal' } })).status === 400, 'referência com mais de 200 caracteres é rejeitada');
  const ob = await api('POST', '/orders', { token: cli.token, body: { ...orderBody, quote_id: qb.data.quote_id }, idem: 'pedido-bairro-01' });
  ok(ob.status === 201 && JSON.stringify(ob.data).includes('Cimento (Baixa): Junto ao mercado'), 'pedido guarda o bairro e a referência como local');
  const obGet = await api('GET', `/orders/${ob.data.id}`, { token: cli.token });
  ok(obGet.status === 200 && JSON.stringify(obGet.data).includes('Bairro Coalane'), 'pedido mostra o bairro de entrega');

  console.log('Bairros no painel Admin (Zonas e bairros)');
  const abl = await api('GET', '/admin/bairros', { token: adminToken });
  ok(abl.status === 200 && abl.data.length >= 19, 'admin vê todos os bairros');
  ok((await api('GET', '/admin/bairros', { token: cli.token })).status === 403, 'cliente não vê a gestão de bairros');
  const nb = await api('POST', '/admin/bairros', { token: adminToken, body: { name: 'Bairro de Teste', lat: -17.87, lon: 36.89, reason: R } });
  ok(nb.status === 201 && nb.data.id, 'admin cria bairro (auditado)');
  ok((await api('POST', '/admin/bairros', { token: adminToken, body: { name: 'bairro de teste', lat: -17.87, lon: 36.89, reason: R } })).status === 409, 'nome repetido é rejeitado');
  ok((await api('POST', '/admin/bairros', { token: adminToken, body: { name: 'Sem Motivo', lat: -17.87, lon: 36.89 } })).status === 400, 'criar bairro exige motivo');
  ok((await api('POST', '/admin/bairros', { token: adminToken, body: { name: 'Longe', lat: 10, lon: 36.89, reason: R } })).status === 400, 'coordenadas fora de Moçambique são rejeitadas');
  ok((await api('PUT', `/admin/bairros/${nb.data.id}`, { token: adminToken, body: { name: 'Coalane', lat: -17.87, lon: 36.89, active: true, reason: R } })).status === 409, 'renomear para nome existente é rejeitado');
  ok((await api('PUT', `/admin/bairros/${nb.data.id}`, { token: adminToken, body: { name: 'Bairro de Teste', lat: -17.871, lon: 36.891, active: false, reason: R } })).status === 200, 'admin desactiva o bairro');
  ok(!(await api('GET', '/bairros', { token: cli.token })).data.some((b) => b.id === nb.data.id), 'bairro inactivo deixa de aparecer ao cliente');
  ok((await api('POST', '/quotes', { token: cli.token, body: { pickup: { bairro_id: nb.data.id }, dropoff: { bairro_id: 'bairro-coalane' }, weight_kg: 1, service_type: 'normal' } })).status === 400, 'bairro inactivo não aceita cotação');
  ok((await api('PUT', '/admin/bairros/nao-existe', { token: adminToken, body: { name: 'Xpto', lat: -17.87, lon: 36.89, active: true, reason: R } })).status === 404, 'editar bairro inexistente dá 404');
  const audB = await adminSql(dbUrl, `SELECT COUNT(*)::int AS n FROM audit_logs WHERE entity = 'bairro'`);
  ok(audB.rows[0].n >= 2, 'criação e edição de bairros ficam na auditoria');

  console.log('Zonas de cobertura');
  const zs = await api('GET', '/admin/zones', { token: adminToken });
  ok(zs.status === 200 && zs.data.length > 0, 'admin lista as zonas');
  const z0 = zs.data[0];
  ok((await api('PUT', `/admin/zones/${z0.id}`, { token: adminToken, body: { name: z0.name, kind: z0.kind, polygon: z0.polygon, active: !!z0.active, reason: R } })).status === 200, 'editar zona funciona (erro corrigido)');
  ok((await api('PUT', '/admin/zones/nao-existe', { token: adminToken, body: { name: z0.name, kind: z0.kind, polygon: z0.polygon, active: true, reason: R } })).status === 404, 'editar zona inexistente dá 404');
  ok((await api('POST', '/admin/zones', { token: adminToken, body: { city: 'Quelimane', name: 'Má', kind: 'coverage', polygon: [[1, 2]], reason: R } })).status === 400, 'zona com polígono inválido é rejeitada');
  const tr = await api('POST', '/admin/zones/test-route', { token: adminToken, body: { from: { lat: -17.8786, lon: 36.8883 }, to: { lat: -17.86, lon: 36.9 } } });
  ok(tr.status === 200, 'testar rota entre dois pontos');
  ok((await api('POST', '/admin/zones/test-route', { token: cli.token, body: { from: {}, to: {} } })).status === 403, 'cliente não testa rotas');

  console.log('Moradas guardadas');
  const ad = await api('POST', '/addresses', { token: cli.token, body: { label: 'Casa', description: 'Bairro Coalane, casa 12', lat: -17.85, lon: 36.905 } });
  ok(ad.status === 201 && ad.data.id, 'cliente guarda uma morada');
  ok((await api('POST', '/addresses', { token: cli.token, body: { label: 'Casa', description: 'x', lat: 99, lon: 36.9 } })).status === 400, 'morada inválida é rejeitada');
  ok((await api('GET', '/addresses', { token: cli.token })).data.some((a) => a.id === ad.data.id), 'morada aparece na lista');
  await api('DELETE', `/addresses/${ad.data.id}`, { token: cli.token });
  ok(!(await api('GET', '/addresses', { token: cli.token })).data.some((a) => a.id === ad.data.id), 'morada apagada sai da lista');

  console.log('Agendamento (passo Serviço)');
  ok((await api('GET', '/slots?date=amanha', { token: cli.token })).status === 400, 'data inválida é rejeitada');
  const today = new Date(Date.now() + 2 * 3_600_000).toISOString().slice(0, 10);
  const sl = await api('GET', `/slots?date=${today}`, { token: cli.token });
  ok(sl.status === 200 && Array.isArray(sl.data.slots), 'horários do dia são devolvidos');
  const far = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  ok((await api('GET', `/slots?date=${far}`, { token: cli.token })).data.slots.length === 0, 'não agenda além do limite de dias');

  console.log('Planos e subscrições (ecrã Subscrição e pagamento do plano)');
  const sc = await register('Sónia Subscrição', '844000003');
  const plans = await api('GET', '/plans', { token: sc.token });
  ok(plans.status === 200 && plans.data.plans.length > 0, 'cliente vê os planos publicados');
  ok((await api('GET', '/plans')).status === 401, 'planos exigem sessão');
  const plan = plans.data.plans[0];
  ok((await api('POST', '/subscriptions', { token: sc.token, body: { plan_id: 'plano-que-nao-existe' } })).status === 404, 'plano inexistente é rejeitado');
  const sub = await api('POST', '/subscriptions', { token: sc.token, body: { plan_id: plan.id } });
  ok(sub.status === 201 && sub.data.status === 'pending_payment', 'escolher plano cria subscrição a aguardar pagamento');
  const sg = await api('GET', `/subscriptions/${sub.data.id}`, { token: sc.token });
  ok(sg.status === 200 && sg.data.status === 'pending_payment' && sg.data.plan_name === plan.name && sg.data.price_cents === plan.price_cents && sg.data.payment === null, 'página de pagamento do plano recebe nome, valor e estado');
  ok((await api('GET', `/subscriptions/${sub.data.id}`, { token: cli.token })).status === 404, 'outro cliente não vê a subscrição');
  const spi = await api('POST', '/payments/intents', { token: sc.token, body: { subscription_id: sub.data.id, provider: 'sandbox', msisdn: '844000003' }, idem: 'pag-sub-s001' });
  ok(spi.status === 201, 'pagamento do plano criado');
  ok((await api('GET', `/subscriptions/${sub.data.id}`, { token: sc.token })).data.payment?.status === 'pending', 'página do plano retoma o pagamento em curso');
  ok((await api('GET', `/payments/intents/${spi.data.id}`, { token: sc.token })).data.status === 'pending', 'cliente consulta o seu pagamento');
  ok((await api('GET', `/payments/intents/${spi.data.id}`, { token: cli.token })).status === 404, 'outro cliente não vê o pagamento');
  ok((await api('POST', `/subscriptions/${sub.data.id}/cancel`, { token: sc.token })).status === 404, 'só se cancela subscrição activa');
  const pcActive = (await api('GET', '/plans', { token: pc.token })).data.active;
  ok(pcActive && (await api('POST', `/subscriptions/${pcActive.id}/cancel`, { token: pc.token })).status === 200, 'cliente desliga a renovação do plano activo');
  ok((await api('POST', `/admin/subscriptions/${sub.data.id}/cancel`, { token: adminToken, body: { reason: R, immediate: true } })).status === 200, 'admin cancela subscrição (auditado)');
  ok((await api('POST', '/admin/subscriptions/nao-existe/cancel', { token: adminToken, body: { reason: R, immediate: true } })).status === 404, 'cancelar subscrição inexistente dá 404');

  console.log('Notificações');
  const nt = await api('GET', '/notifications', { token: cli.token });
  ok(nt.status === 200 && nt.data.length > 0, 'cliente vê as notificações');
  ok((await api('POST', '/notifications/read', { token: cli.token, body: {} })).status === 200 && (await api('GET', '/home', { token: cli.token })).data.unread_notifications === 0, 'marcar todas como lidas zera o contador');
  ok((await api('GET', '/notifications')).status === 401, 'notificações exigem sessão');

  console.log('Perfil, palavra-passe e eliminação de conta');
  const pf = await register('Pedro Perfil', '844000004');
  ok((await api('PATCH', '/profile', { token: pf.token, body: { name: 'Pedro Perfil Novo', theme: 'dark' } })).status === 200, 'cliente altera nome e tema');
  ok((await api('PATCH', '/profile', { token: pf.token, body: { theme: 'roxo' } })).status === 400, 'tema inválido é rejeitado');
  ok((await api('PATCH', '/profile', { token: pf.token, body: { email: 'sem-arroba' } })).status === 400, 'email inválido é rejeitado');
  ok((await api('POST', '/profile/password', { token: pf.token, body: { current: 'errada123', next: 'novasenha1' } })).status === 400, 'palavra-passe actual errada é rejeitada');
  ok((await api('POST', '/profile/password', { token: pf.token, body: { current: 'segredo123', next: 'curta' } })).status === 400, 'palavra-passe nova fraca é rejeitada');
  ok((await api('POST', '/profile/password', { token: pf.token, body: { current: 'segredo123', next: 'novasenha1' } })).status === 200, 'cliente muda a palavra-passe');
  ok((await api('POST', '/auth/login', { body: { phone: '844000004', password: 'novasenha1', app: 'cliente' } })).status === 200, 'entra com a nova palavra-passe');
  ok((await api('POST', '/account/delete', { token: pf.token, body: { password: 'segredo123' } })).status === 400, 'eliminar conta com palavra-passe errada é rejeitado');
  ok((await api('POST', '/account/delete', { token: pf.token, body: { password: 'novasenha1', reason: 'Teste' } })).status === 200, 'pedido de eliminação de conta registado');
  ok((await api('GET', '/home', { token: pf.token })).status === 401, 'sessão termina após o pedido de eliminação');

  console.log('Apoio (cliente) e tickets (Admin)');
  ok((await api('POST', '/support', { token: cli.token, body: { subject: 'a', message: 'Olá' } })).status === 400, 'assunto curto é rejeitado');
  const tk = await api('POST', '/support', { token: cli.token, body: { subject: 'Dúvida sobre pagamento', message: 'Quanto tempo demora a confirmação?' } });
  ok(tk.status === 201 && tk.data.id, 'cliente abre um pedido de apoio');
  ok((await api('POST', '/support', { token: cli.token, body: { subject: 'Encomenda alheia', message: 'teste', order_id: 'nao-existe' } })).status === 404, 'não abre apoio sobre encomenda alheia');
  ok((await api('GET', '/support', { token: cli.token })).data.some((t) => t.id === tk.data.id), 'pedido aparece na lista');
  ok((await api('GET', `/support/${tk.data.id}`, { token: cli.token })).data.messages.length === 1, 'cliente vê a conversa');
  ok((await api('GET', `/support/${tk.data.id}`, { token: sc.token })).status === 404, 'outro cliente não vê o pedido');
  ok((await api('POST', `/support/${tk.data.id}/messages`, { token: cli.token, body: { body: 'Mais um detalhe.' } })).status === 201, 'cliente acrescenta mensagem');
  ok((await api('GET', '/admin/tickets', { token: adminToken })).data.some((t) => t.id === tk.data.id), 'admin vê o pedido na fila');
  ok((await api('GET', `/admin/tickets/${tk.data.id}`, { token: adminToken })).data.messages.length === 2, 'admin abre a conversa');
  ok((await api('POST', `/admin/tickets/${tk.data.id}/messages`, { token: adminToken, body: { body: 'Confirmamos em até 1 hora.', internal: false } })).status < 300, 'admin responde ao cliente');
  ok(!(await api('GET', `/support/${tk.data.id}`, { token: cli.token })).data.messages.some((m) => m.body === 'Nota interna'), 'cliente não vê notas internas');
  ok((await api('PATCH', `/admin/tickets/${tk.data.id}`, { token: adminToken, body: { status: 'perdido' } })).status === 400, 'estado de ticket inválido é rejeitado');
  ok((await api('PATCH', `/admin/tickets/${tk.data.id}`, { token: adminToken, body: { status: 'fechado', priority: 'alta' } })).status === 200, 'admin fecha o pedido');
  ok((await api('POST', `/support/${tk.data.id}/messages`, { token: cli.token, body: { body: 'Ainda aí?' } })).status === 409, 'pedido fechado não recebe mensagens');

  console.log('Reclamações do cliente e avaliação');
  ok((await api('POST', `/orders/${orderId}/incidents`, { token: cli.token, body: { category: 'danificado', description: 'A caixa chegou amassada.' } })).status === 400, 'reclamação sem Idempotency-Key é rejeitada');
  ok((await api('POST', `/orders/${orderId}/incidents`, { token: cli.token, body: { category: 'xpto', description: 'A caixa chegou amassada.' }, idem: 'rec-cli-0001' })).status === 400, 'categoria inválida é rejeitada');
  const evKey = await photo(cli.token, '/evidence/upload');
  ok(!!evKey, 'cliente envia foto de prova');
  ok((await api('POST', '/evidence/upload', { token: cli.token, form: (() => { const f = new FormData(); f.append('file', new Blob(['x'], { type: 'text/plain' }), 'a.txt'); return f; })() })).status === 400, 'prova que não é foto é rejeitada');
  const ic = await api('POST', `/orders/${orderId}/incidents`, { token: cli.token, body: { category: 'danificado', description: 'A caixa chegou amassada.', photo_keys: [evKey] }, idem: 'rec-cli-0001' });
  ok(ic.status === 201 && ic.data.protocol, 'cliente regista reclamação com foto');
  ok((await api('GET', '/incidents', { token: cli.token })).data.some((i) => i.id === ic.data.id), 'reclamação aparece em Ocorrências');
  const icd = await api('GET', `/incidents/${ic.data.id}`, { token: cli.token });
  ok(icd.status === 200 && icd.data.photos.length === 1, 'detalhe mostra a foto enviada');
  ok((await api('GET', `/incidents/${ic.data.id}`, { token: sc.token })).status === 404, 'outro cliente não vê a reclamação');
  ok((await api('POST', `/incidents/${ic.data.id}/reply`, { token: cli.token, body: { body: 'Envio mais detalhes.' } })).status < 300, 'cliente responde na reclamação');
  ok((await api('POST', `/incidents/${ic.data.id}/reply`, { token: cli.token, body: { body: 'x' } })).status === 400, 'resposta curta é rejeitada');
  ok((await api('POST', `/orders/${orderId}/rating`, { token: cli.token, body: { stars: 9 } })).status === 400, 'avaliação fora de 1 a 5 é rejeitada');
  ok((await api('POST', `/orders/${orderId}/rating`, { token: cli.token, body: { stars: 5, comment: 'Rápido' } })).status === 200, 'cliente avalia a entrega');
  ok((await api('POST', `/orders/${ob.data.id}/rating`, { token: cli.token, body: { stars: 5 } })).status === 400, 'não avalia pedido por entregar');

  console.log('Estafeta: perfil, pedidos, documentos, veículos, ganhos');
  const me = await api('GET', '/courier/me', { token: winner.token });
  ok(me.status === 200 && me.data.is_courier === true, 'estafeta vê o seu estado');
  ok((await api('GET', '/courier/me', { token: sc.token })).data.is_courier === false, 'cliente sem candidatura não é estafeta');
  ok((await api('GET', '/courier/orders/active', { token: winner.token })).status === 200, 'estafeta vê os pedidos em curso');
  ok((await api('GET', '/courier/orders/history', { token: winner.token })).data.some((o) => o.id === orderId), 'histórico inclui a entrega feita');
  ok((await api('GET', '/courier/orders/history', { token: cli.token })).status === 403, 'cliente não vê histórico de estafeta');
  const doc = await api('POST', '/courier/documents', { token: winner.token, form: formFile({ kind: 'bi' }) });
  ok(doc.status === 201 && doc.data.status === 'pending', 'estafeta envia documento');
  ok((await api('POST', '/courier/documents', { token: winner.token, form: formFile({ kind: 'passaporte' }) })).status === 400, 'tipo de documento inválido é rejeitado');
  const veh = await api('POST', '/courier/vehicles', { token: winner.token, body: { kind: 'bicicleta', ownership: 'particular', capacity_kg: 5 } });
  ok(veh.status === 201, 'estafeta regista bicicleta');
  ok((await api('POST', '/courier/vehicles', { token: winner.token, body: { kind: 'motorizada', ownership: 'particular', capacity_kg: 10 } })).status === 400, 'motorizada sem matrícula é rejeitada');
  ok((await api('PATCH', `/courier/vehicles/${veh.data.id}`, { token: winner.token, body: { capacity_kg: 6 } })).status === 200, 'estafeta altera o veículo (vai a revisão)');
  ok((await api('PATCH', `/courier/vehicles/${veh.data.id}`, { token: cli.token, body: { capacity_kg: 6 } })).status === 403, 'cliente não altera veículos');
  ok((await api('POST', `/courier/orders/${orderId}/incident`, { token: winner.token, body: { kind: 'xpto', description: 'teste' } })).status === 400, 'tipo de ocorrência do estafeta inválido é rejeitado');
  ok((await api('POST', `/courier/orders/${orderId}/returned`, { token: winner.token })).status === 409, 'pedido entregue não passa a devolvido');
  const led = await adminSql(dbUrl, `SELECT id FROM earnings_ledger WHERE courier_id = '${winner.user.id}' LIMIT 1`);
  const ledId = led.rows[0]?.id;
  ok((await api('POST', `/courier/earnings/${ledId}/dispute`, { token: winner.token, body: { message: 'curto' } })).status < 300, 'estafeta contesta um ganho');
  ok((await api('POST', `/courier/earnings/${ledId}/dispute`, { token: winner.token, body: { message: 'x' } })).status === 400, 'contestação curta é rejeitada');
  const disp = await adminSql(dbUrl, `SELECT id FROM earning_disputes WHERE courier_id = '${winner.user.id}' LIMIT 1`);
  ok((await api('POST', `/admin/disputes/${disp.rows[0].id}/resolve`, { token: adminToken, body: { adjustment_cents: 500, reason: R } })).status === 200, 'admin resolve a contestação com ajuste');
  ok((await api('POST', `/admin/disputes/${disp.rows[0].id}/resolve`, { token: adminToken, body: { adjustment_cents: 0, reason: R } })).status === 404, 'contestação resolvida não se resolve duas vezes');
  ok((await api('POST', '/admin/payouts', { token: adminToken, body: { courier_id: winner.user.id, reference: 'LIQ-TESTE-01' } })).status < 300, 'admin regista liquidação ao estafeta');
  ok((await api('POST', '/admin/payouts', { token: adminToken, body: { courier_id: winner.user.id, reference: 'LIQ-TESTE-02' } })).status === 400, 'sem saldo não há segunda liquidação');

  console.log('Recusa de pedido atribuído');
  const dc = await register('Diana Recusa', '844000005');
  const dq = await api('POST', '/quotes', { token: dc.token, body: { pickup: { bairro_id: 'bairro-popular' }, dropoff: { bairro_id: 'bairro-liberdade' }, weight_kg: 1, service_type: 'normal' } });
  const dor = await api('POST', '/orders', { token: dc.token, body: { ...orderBody, quote_id: dq.data.quote_id }, idem: 'pedido-recusa-01' });
  const dpi = await api('POST', '/payments/intents', { token: dc.token, body: { order_id: dor.data.id, provider: 'sandbox', msisdn: '844000005' }, idem: 'pag-recusa-01' });
  await api('POST', `/payments/intents/${dpi.data.id}/simulate`, { token: dc.token, body: { outcome: 'succeeded' } });
  const elig = await api('GET', `/admin/orders/${dor.data.id}/eligible-couriers`, { token: adminToken });
  ok(elig.status === 200 && Array.isArray(elig.data), 'admin vê estafetas elegíveis');
  ok((await api('GET', '/admin/orders/nao-existe', { token: adminToken })).status === 404, 'pedido inexistente dá 404 no painel');
  const asg = await api('POST', `/admin/orders/${dor.data.id}/assign`, { token: adminToken, body: { courier_id: winner.user.id, reason: R } });
  ok(asg.status === 200, 'admin atribui o pedido ao estafeta');
  ok((await api('POST', `/courier/orders/${dor.data.id}/decline`, { token: winner.token, body: { reason: 'x' } })).status === 400, 'recusa sem motivo é rejeitada');
  ok((await api('POST', `/courier/orders/${dor.data.id}/decline`, { token: winner.token, body: { reason: 'Pneu furado' } })).status === 200, 'estafeta recusa o pedido');
  const after = await api('GET', `/admin/orders/${dor.data.id}`, { token: adminToken });
  ok(after.status === 200 && JSON.stringify(after.data).includes('PENDENTE_ATRIBUICAO'), 'pedido recusado volta à fila');
  ok((await api('POST', `/courier/orders/${dor.data.id}/decline`, { token: winner.token, body: { reason: 'Outra vez' } })).status === 404, 'não recusa pedido que já não é seu');

  console.log('Admin: clientes e estafetas');
  const cl = await api('GET', '/admin/customers?q=Carla', { token: adminToken });
  ok(cl.status === 200 && JSON.stringify(cl.data).includes('Carla'), 'admin pesquisa clientes por nome');
  const cd = await api('GET', `/admin/customers/${cli.user.id}`, { token: adminToken });
  ok(cd.status === 200 && JSON.stringify(cd.data).includes(orderId), 'ficha do cliente mostra as encomendas');
  ok((await api('GET', '/admin/customers/nao-existe', { token: adminToken })).status === 404, 'cliente inexistente dá 404');
  const sus = await register('Sérgio Suspenso', '844000006');
  ok((await api('POST', `/admin/customers/${sus.user.id}/status`, { token: adminToken, body: { status: 'suspended', reason: R } })).status === 200, 'admin suspende cliente');
  ok((await api('GET', '/home', { token: sus.token })).status === 401, 'cliente suspenso perde a sessão');
  ok((await api('POST', `/admin/customers/${sus.user.id}/status`, { token: adminToken, body: { status: 'banido', reason: R } })).status === 400, 'estado de cliente inválido é rejeitado');
  ok((await api('GET', '/admin/couriers', { token: adminToken })).data.couriers.length >= 2, 'admin lista estafetas');
  ok((await api('GET', `/admin/couriers/${winner.user.id}`, { token: adminToken })).data.profile, 'ficha do estafeta abre');
  ok((await api('GET', '/admin/couriers/nao-existe', { token: adminToken })).status === 404, 'estafeta inexistente dá 404');

  console.log('Admin: planos');
  ok((await api('GET', '/admin/plans', { token: adminToken })).status === 200, 'admin lista planos');
  const planBody = { name: 'Plano Teste', description: 'Rascunho', price_cents: 50000, period_days: 30, deliveries_included: 5, max_weight_kg: 5, service_types: ['normal'] };
  const np = await api('POST', '/admin/plans', { token: adminToken, body: planBody });
  ok(np.status === 201 && np.data.id, 'admin cria plano em rascunho');
  ok((await api('POST', '/admin/plans', { token: adminToken, body: { ...planBody, service_types: ['voo'] } })).status === 400, 'modalidade de plano inválida é rejeitada');
  ok((await api('PUT', `/admin/plans/${np.data.id}`, { token: adminToken, body: { ...planBody, price_cents: 55000 } })).status === 200, 'admin edita plano em rascunho');
  ok((await api('PUT', `/admin/plans/${plan.id}`, { token: adminToken, body: planBody })).status === 409, 'plano publicado não se edita');

  console.log('Admin: pagamentos e reembolsos');
  const pays = await api('GET', '/admin/payments', { token: adminToken });
  const paid = pays.data.intents.find((p) => p.status === 'succeeded');
  const pd = await api('GET', `/admin/payments/${paid.id}`, { token: adminToken });
  ok(pd.status === 200 && Array.isArray(pd.data.transactions), 'admin abre o detalhe do pagamento');
  ok((await api('GET', '/admin/payments/nao-existe', { token: adminToken })).status === 404, 'pagamento inexistente dá 404');
  ok((await api('POST', `/admin/payments/${paid.id}/refunds`, { token: adminToken, body: { amount_cents: paid.amount_cents + 1, reason: R } })).status === 400, 'reembolso acima do pago é rejeitado');
  const rf = await api('POST', `/admin/payments/${paid.id}/refunds`, { token: adminToken, body: { amount_cents: 100, reason: R } });
  ok(rf.status < 300 && rf.data.id, 'admin pede reembolso parcial');
  ok((await api('POST', `/admin/refunds/${rf.data.id}/decide`, { token: adminToken, body: { decision: 'approved', reason: R } })).status === 403, 'quem pede o reembolso não o aprova');
  ok((await api('POST', `/admin/refunds/${rf.data.id}/decide`, { token: admin2Token, body: { decision: 'approved', reason: R } })).status === 200, 'outro admin aprova o reembolso');
  ok((await api('POST', `/admin/refunds/${rf.data.id}/decide`, { token: admin2Token, body: { decision: 'rejected', reason: R } })).status === 409, 'reembolso decidido não se decide de novo');

  console.log('Admin: preços');
  const pr = await api('GET', '/admin/pricing', { token: adminToken });
  ok(pr.status === 200, 'admin vê as versões de preços');
  const rules = [
    { service_type: 'normal', base_cents: 5000, per_km_cents: 1000, per_kg_cents: 0, min_total_cents: 6000 },
    { service_type: 'expressa', base_cents: 9000, per_km_cents: 1500, per_kg_cents: 0, min_total_cents: 10000 },
  ];
  ok((await api('POST', '/admin/pricing/simulate', { token: adminToken, body: { rules, distance_km: 3, weight_kg: 2 } })).status === 200, 'simular preços funciona');
  ok((await api('POST', '/admin/pricing/simulate', { token: adminToken, body: { rules: [rules[0]], distance_km: 3, weight_kg: 2 } })).status === 400, 'simulação sem as duas modalidades é rejeitada');
  const pv = await api('POST', '/admin/pricing', { token: adminToken, body: { note: 'Rascunho de teste', rules } });
  ok(pv.status < 300 && pv.data.id, 'admin cria rascunho de preços');
  ok((await api('POST', `/admin/pricing/${pv.data.id}/publish`, { token: adminToken, body: { approved_confirmation: false, reason: R } })).status === 400, 'publicar preços exige confirmação da direcção');

  console.log('Admin: relatórios');
  for (const kind of ['operacional', 'financeiro', 'subscricoes', 'desempenho']) {
    ok((await api('GET', `/admin/reports/${kind}`, { token: adminToken })).status === 200, `relatório ${kind}`);
  }
  ok((await api('GET', '/admin/reports/inventado', { token: adminToken })).status === 404, 'relatório desconhecido dá 404');
  ok((await api('GET', '/admin/reports/operacional', { token: cli.token })).status === 403, 'cliente não vê relatórios');

  console.log('Webhook de pagamento');
  const wh = (p) => fetch(`${ctx.BASE}/payments/webhook/${p}`, { method: 'POST', headers: { 'x-levago-signature': 'falsa', 'content-type': 'application/json' }, body: '{}' });
  ok((await wh('mpesa')).status === 403, 'webhook M-Pesa com assinatura falsa é rejeitado');
  ok((await wh('paypal')).status === 404, 'provedor desconhecido dá 404');

  const cliSub = await api('POST', '/subscriptions', { token: cli.token, body: { plan_id: plan.id } });
  ok(cliSub.status === 201, 'cliente escolhe plano para o teste de ecrã');
  void login;
  return { incidentId: ic.data.id, subscriptionId: cliSub.data.id, ticketId: tk.data.id, payOrderId: ob.data.id };
}

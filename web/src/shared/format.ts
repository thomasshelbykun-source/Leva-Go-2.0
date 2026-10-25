// Formatação local: Moçambique (MZN, Africa/Maputo).
const TZ = 'Africa/Maputo';

export const mt = (cents: number | null | undefined) =>
  `${((cents ?? 0) / 100).toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MT`;

export const km = (m: number | null | undefined) => `${((m ?? 0) / 1000).toLocaleString('pt-PT', { maximumFractionDigits: 1 })} km`;

export const dateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('pt-PT', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

export const time = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString('pt-PT', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }) : '';

export const minutes = (s: number | null | undefined) => `${Math.max(1, Math.round((s ?? 0) / 60))} min`;

/** Data de hoje (AAAA-MM-DD) em Maputo. */
export const todayMaputo = (offsetDays = 0) =>
  new Date(Date.now() + offsetDays * 86_400_000).toLocaleDateString('en-CA', { timeZone: TZ });

export const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

export const STATUS_TONE: Record<string, string> = {
  AGUARDA_PAGAMENTO: 'warn',
  PENDENTE_ATRIBUICAO: 'info',
  ATRIBUIDO: 'info',
  ACEITE: 'info',
  RECOLHIDO: 'info',
  EM_TRANSPORTE: 'info',
  ENTREGUE: 'ok',
  CANCELADO: 'muted',
  FALHA_ENTREGA: 'bad',
  DEVOLUCAO_PENDENTE: 'warn',
  DEVOLVIDO: 'muted',
};

export const STATUS_LABEL: Record<string, string> = {
  AGUARDA_PAGAMENTO: 'A aguardar pagamento',
  PENDENTE_ATRIBUICAO: 'À procura de estafeta',
  ATRIBUIDO: 'Estafeta atribuído',
  ACEITE: 'Estafeta a caminho da recolha',
  RECOLHIDO: 'Encomenda recolhida',
  EM_TRANSPORTE: 'Em transporte',
  ENTREGUE: 'Entregue',
  CANCELADO: 'Cancelado',
  FALHA_ENTREGA: 'Falha na entrega',
  DEVOLUCAO_PENDENTE: 'Devolução pendente',
  DEVOLVIDO: 'Devolvido',
};

/** Etapas da barra de progresso: Pedido, Recolhido, Em transporte e Entregue. */
export const STAGE_LABELS = ['Pedido', 'Recolhido', 'Em transporte', 'Entregue'];
const STAGE: Record<string, number> = { AGUARDA_PAGAMENTO: 0, PENDENTE_ATRIBUICAO: 1, ATRIBUIDO: 1, ACEITE: 1, RECOLHIDO: 2, EM_TRANSPORTE: 3, ENTREGUE: 4 };
/** Etapa actual (0 a 4), ou -1 quando o pedido não segue o caminho normal (cancelado, falha, devolução). */
export const stageOf = (status: string) => STAGE[status] ?? -1;

/** Frase curta para o topo do ecrã de seguimento. */
export const HEADLINE: Record<string, string> = {
  AGUARDA_PAGAMENTO: 'Falta pagar o pedido',
  PENDENTE_ATRIBUICAO: 'À procura de estafeta',
  ATRIBUIDO: 'Estafeta a confirmar o pedido',
  ACEITE: 'O estafeta vai a caminho da recolha',
  RECOLHIDO: 'Encomenda recolhida',
  EM_TRANSPORTE: 'A encomenda está a caminho',
  ENTREGUE: 'Encomenda entregue',
  CANCELADO: 'Pedido cancelado',
  FALHA_ENTREGA: 'Não foi possível entregar',
  DEVOLUCAO_PENDENTE: 'A encomenda vai voltar à recolha',
  DEVOLVIDO: 'Encomenda devolvida',
};

export const CATEGORIES: Record<string, string> = {
  documentos: 'Documentos',
  roupa: 'Roupa',
  comida: 'Comida',
  electronicos: 'Electrónicos',
  medicamentos: 'Medicamentos',
  compras: 'Compras',
  outro: 'Outro',
};

export const SERVICE: Record<string, string> = { normal: 'Normal', expressa: 'Expressa' };
export const PAY_METHOD: Record<string, string> = { mpesa: 'M-Pesa', emola: 'e-Mola', na_entrega: 'Na entrega', sandbox: 'Teste (simulado)', subscricao: 'Subscrição' };

/** Rótulos em português para estados internos (candidaturas, planos, tarifas, documentos, perfis). */
const LABELS: Record<string, string> = {
  pending: 'Pendente', approved: 'Aprovado', rejected: 'Rejeitado', active: 'Activo', suspended: 'Suspenso',
  inactive: 'Inactivo', draft: 'Rascunho', published: 'Publicado', archived: 'Arquivado', cancelled: 'Cancelado',
  expired: 'Expirado', paid: 'Pago', failed: 'Falhou', open: 'Aberto', closed: 'Fechado', resolved: 'Resolvido',
  aberto: 'Aberto', em_curso: 'Em curso', fechado: 'Fechado', resolvido: 'Resolvido', accepted: 'Aceite', declined: 'Recusado',
  offered: 'Oferecido', completed: 'Concluído', done: 'Concluído', deleted: 'Eliminado', refunded: 'Reembolsado', requested: 'Pedido',
  retired: 'Retirado', revoked: 'Revogado', succeeded: 'Confirmado', void: 'Anulado', pending_payment: 'A aguardar pagamento',
  collect_on_delivery: 'Pagar na entrega', not_required: 'Não necessário', low: 'Baixa', normal: 'Normal', high: 'Alta', urgent: 'Urgente',
  codigo: 'Código', checklist: 'Lista de verificação', foto: 'Foto', assinatura: 'Assinatura',
  independente: 'Independente', proprio: 'Próprio', bicicleta: 'Bicicleta', motorizada: 'Motorizada',
};
export const lbl = (s: string | null | undefined) => (s ? LABELS[s] ?? s : '-');

/** Ligação do Google Maps com a rota até ao destino. */
export const mapsLink = (lat: number, lon: number) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=driving`;

/** Texto e ligação para partilhar o seguimento por WhatsApp. */
export const whatsappLink = (code: string, url: string) =>
  `https://wa.me/?text=${encodeURIComponent(`Acompanhe a encomenda ${code} da LevaGo: ${url}`)}`;

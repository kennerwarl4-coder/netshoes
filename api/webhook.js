const { updateOrderStatus, getOrder } = require('../lib/orders');
const { sendMetaPurchaseEvent } = require('../lib/meta-pixel');

module.exports = async function handler(req, res) {
  // CORS / methods
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-requested-with');

  if (req.method === 'OPTIONS') {
    return res.status ? res.status(200).end() : (res.writeHead(200), res.end());
  }

  if (req.method !== 'POST') {
    if (res.status) return res.status(405).json({ error: 'Método não permitido.' });
    res.writeHead(405, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Método não permitido.' }));
  }

  try {
    const payload = typeof req.body === 'object' && req.body !== null ? req.body : JSON.parse(req.body || '{}');

    console.log('[Webhook SigiloPay] Notificação recebida:', JSON.stringify({
      event: payload.event,
      transactionId: payload.transaction?.id,
      token: payload.token
    }));

    const event = payload.event;
    const tx = payload.transaction || {};
    const transactionId = tx.id;
    const identifier = tx.identifier || payload.metadata?.orderId || payload.order?.id;

    // Search order by identifier or transactionId
    const targetKey = identifier || transactionId;
    const existingOrder = getOrder(targetKey) || (transactionId ? getOrder(transactionId) : null);

    let newStatus = null;

    // Critical: Decide status by event name per SigiloPay docs
    switch (event) {
      case 'TRANSACTION_PAID':
        newStatus = 'PAID';
        break;
      case 'TRANSACTION_CANCELED':
        newStatus = 'CANCELED';
        break;
      case 'TRANSACTION_REFUNDED':
        newStatus = 'REFUNDED';
        break;
      case 'TRANSACTION_CHARGED_BACK':
        newStatus = 'CHARGED_BACK';
        break;
      case 'TRANSACTION_CREATED':
        newStatus = 'PENDING';
        break;
      default:
        console.log(`[Webhook SigiloPay] Evento desconhecido ou não-mapeado: ${event}`);
    }

    if (newStatus && (existingOrder || targetKey)) {
      const orderIdToUpdate = existingOrder ? existingOrder.identifier : targetKey;
      const updatedOrder = updateOrderStatus(orderIdToUpdate, newStatus, {
        webhookEvent: event,
        paidAt: tx.payedAt || (newStatus === 'PAID' ? new Date().toISOString() : null),
        lastWebhookPayload: payload
      });
      console.log(`[Webhook SigiloPay] Pedido ${orderIdToUpdate} atualizado para status: ${newStatus}`);

      // If payment approved, trigger Meta Conversions API purchase event (with anti-duplication)
      if (newStatus === 'PAID') {
        const clientIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress;
        const userAgent = req.headers['user-agent'];
        sendMetaPurchaseEvent(updatedOrder, { clientIp, userAgent }).catch(err => {
          console.warn('[Webhook] Aviso ao enviar evento para Meta CAPI:', err.message);
        });
      }
    } else {
      console.warn(`[Webhook SigiloPay] Pedido não encontrado para ${targetKey}`);
    }

    const successResponse = { received: true, event, status: newStatus };
    if (res.status) {
      return res.status(200).json(successResponse);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(successResponse));
  } catch (err) {
    console.error('[Webhook SigiloPay] Erro no processamento do webhook:', err);
    if (res.status) return res.status(200).json({ received: true, error: err.message });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ received: true, error: err.message }));
  }
};

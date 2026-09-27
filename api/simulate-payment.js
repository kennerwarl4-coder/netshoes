const { updateOrderStatus, getOrder } = require('../lib/orders');
const { sendMetaPurchaseEvent } = require('../lib/meta-pixel');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status ? res.status(200).end() : (res.writeHead(200), res.end());
  }

  let identifier = '';
  if (req.method === 'POST') {
    const body = typeof req.body === 'object' && req.body !== null ? req.body : JSON.parse(req.body || '{}');
    identifier = body.identifier || body.id;
  } else {
    const url = new URL(req.url, 'http://localhost');
    identifier = url.searchParams.get('identifier') || url.searchParams.get('id');
  }

  if (!identifier) {
    const err = { success: false, error: 'Parâmetro identifier é obrigatório.' };
    if (res.status) return res.status(400).json(err);
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(err));
  }

  const order = getOrder(identifier);
  if (!order) {
    const err = { success: false, error: 'Pedido não encontrado.' };
    if (res.status) return res.status(404).json(err);
    res.writeHead(404, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(err));
  }

  const updatedOrder = updateOrderStatus(order.identifier, 'PAID', {
    paidAt: new Date().toISOString(),
    simulation: true
  });

  // Trigger Meta CAPI purchase event with anti-duplication
  const clientIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress;
  const userAgent = req.headers['user-agent'];
  sendMetaPurchaseEvent(updatedOrder, { clientIp, userAgent }).catch(metaErr => {
    console.warn('[simulate-payment] Meta Purchase error:', metaErr.message);
  });

  const successPayload = {
    success: true,
    message: 'Pagamento simulado com sucesso (status alterado para PAID)',
    order: {
      identifier: order.identifier,
      status: 'PAID'
    }
  };

  if (res.status) return res.status(200).json(successPayload);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(successPayload));
};

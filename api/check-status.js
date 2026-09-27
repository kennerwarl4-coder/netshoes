const { getOrder } = require('../lib/orders');
const { sendMetaPurchaseEvent } = require('../lib/meta-pixel');

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status ? res.status(200).end() : (res.writeHead(200), res.end());
  }

  // Parse query parameters
  let query = {};
  if (req.query) {
    query = req.query;
  } else if (req.url && req.url.includes('?')) {
    const searchParams = new URLSearchParams(req.url.split('?')[1]);
    query = Object.fromEntries(searchParams.entries());
  }

  const identifier = query.identifier || query.id || query.transactionId;

  if (!identifier) {
    const errObj = { success: false, error: 'Parâmetro "identifier" ou "id" obrigatório.' };
    if (res.status) return res.status(400).json(errObj);
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(errObj));
  }

  const order = getOrder(identifier);

  if (!order) {
    const notFoundObj = {
      success: true,
      found: false,
      status: 'NOT_FOUND',
      paid: false
    };
    if (res.status) return res.status(404).json(notFoundObj);
    res.writeHead(404, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(notFoundObj));
  }

  // If order is paid and Meta Purchase hasn't been sent yet, send it now
  if (order.status === 'PAID' && !order.metaPurchaseSent) {
    const clientIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress;
    const userAgent = req.headers['user-agent'];
    sendMetaPurchaseEvent(order, { clientIp, userAgent }).catch(err => {
      console.warn('[check-status] Erro ao enviar purchase para Meta:', err.message);
    });
  }

  const responsePayload = {
    success: true,
    found: true,
    identifier: order.identifier,
    transactionId: order.transactionId,
    status: order.status,
    paid: order.status === 'PAID',
    amount: order.amount,
    updatedAt: order.updatedAt,
    clientName: order.client?.name || ''
  };

  if (res.status) {
    return res.status(200).json(responsePayload);
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(responsePayload));
};

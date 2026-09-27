const crypto = require('crypto');
const { createPixCharge, getCredentials } = require('../lib/sigilopay');
const { saveOrder } = require('../lib/orders');

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-requested-with');

  if (req.method === 'OPTIONS') {
    return res.status ? res.status(200).end() : (res.writeHead(200), res.end());
  }

  if (req.method !== 'POST') {
    const errorBody = JSON.stringify({ success: false, error: 'Método não permitido. Utilize POST.' });
    if (res.status) return res.status(405).json({ success: false, error: 'Método não permitido.' });
    res.writeHead(405, { 'Content-Type': 'application/json' });
    return res.end(errorBody);
  }

  const creds = getCredentials();
  if (!creds.isConfigured) {
    const errMsg = 'Credenciais da SigiloPay não configuradas. Defina SIGILOPAY_PUBLIC_KEY e SIGILOPAY_SECRET_KEY no arquivo .env.';
    if (res.status) return res.status(400).json({ success: false, error: errMsg });
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: false, error: errMsg }));
  }

  try {
    const body = typeof req.body === 'object' && req.body !== null ? req.body : JSON.parse(req.body || '{}');

    const { client, shipping, size = '41', amount = 287.90 } = body;

    if (!client || !client.name || !client.email || !client.phone || (!client.cpf && !client.document)) {
      const msg = 'Dados do cliente incompletos. Informe nome, e-mail, telefone e CPF.';
      if (res.status) return res.status(400).json({ success: false, error: msg });
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: msg }));
    }

    const documentNumber = client.cpf || client.document;
    const clientData = {
      name: client.name,
      email: client.email,
      phone: client.phone,
      document: documentNumber
    };

    // Unique transaction identifier (alphanumeric, e.g. cv_m5k29x_a1b2)
    const uniqueSuffix = crypto.randomBytes(3).toString('hex');
    const identifier = `cv_${Date.now().toString(36)}_${uniqueSuffix}`;

    const numAmount = Number(parseFloat(amount).toFixed(2)) || 287.90;

    const chargeResult = await createPixCharge({
      identifier,
      amount: numAmount,
      shippingFee: 0,
      extraFee: 0,
      discount: 0,
      client: clientData,
      products: [
        {
          id: 'nike-court-vision-low-masc',
          name: `Tênis Nike Court Vision Low Next Nature Masculino - Tam ${size}`,
          quantity: 1,
          price: numAmount
        }
      ],
      metadata: {
        size: String(size),
        shippingCity: shipping?.city || '',
        shippingUf: shipping?.uf || ''
      }
    });

    if (!chargeResult.success) {
      const errResponse = { success: false, error: chargeResult.error || 'Erro ao gerar Pix' };
      if (res.status) return res.status(400).json(errResponse);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(errResponse));
    }

    // Save order in our database
    const saved = saveOrder({
      identifier,
      transactionId: chargeResult.transactionId,
      status: chargeResult.transactionStatus || 'PENDING',
      amount: numAmount,
      client: clientData,
      shipping: shipping || {},
      pix: chargeResult.pix,
      order: chargeResult.order,
      fee: chargeResult.fee
    });

    const responsePayload = {
      success: true,
      identifier: saved.identifier,
      transactionId: saved.transactionId,
      pix: saved.pix,
      amount: saved.amount
    };

    if (res.status) {
      return res.status(200).json(responsePayload);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(responsePayload));
  } catch (err) {
    console.error('[api/create-pix] Erro ao criar cobrança Pix:', err);
    const errBody = JSON.stringify({ success: false, error: err.message || 'Erro interno do servidor' });
    if (res.status) return res.status(500).json({ success: false, error: err.message });
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(errBody);
  }
};

/**
 * SigiloPay API Client
 * Official Base URL: https://app.sigilopay.com.br/api/v1
 */

const DEFAULT_BASE_URL = 'https://app.sigilopay.com.br/api/v1';

function getCredentials() {
  const publicKey = process.env.SIGILOPAY_PUBLIC_KEY || '';
  const secretKey = process.env.SIGILOPAY_SECRET_KEY || '';
  const baseUrl = (process.env.SIGILOPAY_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const webhookBaseUrl = (process.env.WEBHOOK_BASE_URL || '').replace(/\/+$/, '');

  return {
    publicKey,
    secretKey,
    baseUrl,
    webhookBaseUrl,
    isConfigured: Boolean(publicKey && secretKey)
  };
}

/**
 * Format document (CPF) to standard digits or formatted string
 */
function cleanDigits(val) {
  if (!val) return '';
  return String(val).replace(/\D/g, '');
}

function formatCpf(val) {
  const digits = cleanDigits(val);
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
  }
  return val;
}

/**
 * Creates a Pix charge using POST /gateway/pix/receive
 */
async function createPixCharge(params) {
  const creds = getCredentials();

  if (!creds.isConfigured) {
    throw new Error('Credenciais da SigiloPay não configuradas. Defina SIGILOPAY_PUBLIC_KEY e SIGILOPAY_SECRET_KEY no arquivo .env.');
  }

  const {
    identifier,
    amount,
    shippingFee = 0,
    extraFee = 0,
    discount = 0,
    client,
    products,
    dueDate,
    metadata = {},
    callbackUrl
  } = params;

  if (!identifier) {
    throw new Error('Campo "identifier" é obrigatório.');
  }
  if (!amount || typeof amount !== 'number' || amount <= 0) {
    throw new Error('Campo "amount" deve ser um número positivo.');
  }
  if (!client || !client.name || !client.email || !client.phone || !client.document) {
    throw new Error('Dados do cliente incompletos (name, email, phone e document são obrigatórios).');
  }

  // Determine fixed callback URL per documentation:
  // "Limite de 20 webhooks: Use uma URL fixa para todas as transações e identifique o pedido pelo identifier."
  let finalCallbackUrl = callbackUrl;
  if (!finalCallbackUrl && creds.webhookBaseUrl) {
    finalCallbackUrl = `${creds.webhookBaseUrl}/api/webhook`;
  }

  const payload = {
    identifier: String(identifier),
    amount: Number(amount.toFixed(2)),
    shippingFee: Number(shippingFee.toFixed(2)),
    extraFee: Number(extraFee.toFixed(2)),
    discount: Number(discount.toFixed(2)),
    client: {
      name: client.name.trim(),
      email: client.email.trim(),
      phone: client.phone.trim(),
      document: formatCpf(client.document)
    },
    products: products && products.length > 0 ? products : [
      {
        id: 'court-vision-low-next-nature',
        name: 'Tênis Nike Court Vision Low Next Nature Masculino - Preto',
        quantity: 1,
        price: Number(amount.toFixed(2))
      }
    ],
    metadata: {
      provider: 'CourtVisionCheckout',
      ...metadata
    }
  };

  if (dueDate) {
    payload.dueDate = dueDate;
  }

  if (finalCallbackUrl) {
    payload.callbackUrl = finalCallbackUrl;
  }

  const endpoint = `${creds.baseUrl}/gateway/pix/receive`;

  console.log(`[SigiloPay] Enviando requisição para ${endpoint} (identifier: ${identifier}, amount: R$ ${payload.amount})`);

  let response;
  let textResponse;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'x-public-key': creds.publicKey,
        'x-secret-key': creds.secretKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    textResponse = await response.text();
  } catch (netErr) {
    console.error('[SigiloPay] Erro de rede ao conectar à API:', netErr);
    throw new Error(`Falha de conexão com a SigiloPay: ${netErr.message}`);
  }

  let data;
  try {
    data = JSON.parse(textResponse);
  } catch {
    // If returned HTML, typically CloudFront/WAF 403 geolocation or 502/504
    if (response.status === 403) {
      throw new Error('A API da SigiloPay bloqueou a requisição (Firewall WAF/CloudFront). A API só aceita conexões de locais permitidos (Brasil, EUA, Portugal).');
    }
    throw new Error(`Resposta não-JSON da SigiloPay (HTTP ${response.status}): ${textResponse.slice(0, 300)}`);
  }

  // Check HTTP status or error payload
  if (!response.ok) {
    const errMsg = data.message || data.errorCode || `Erro HTTP ${response.status}`;
    const details = data.details ? ` (${JSON.stringify(data.details)})` : '';
    throw new Error(`SigiloPay erro: ${errMsg}${details}`);
  }

  // Per doc: "⚠️ A resposta pode vir HTTP 200 com status: 'FAILED' — trate como recusa."
  if (data.status === 'FAILED') {
    const reason = data.errorDescription || data.details || data.message || 'Transação Pix recusada pelo gateway.';
    return {
      success: false,
      status: 'FAILED',
      error: reason,
      raw: data
    };
  }

  if (!data.pix || !data.pix.code) {
    console.warn('[SigiloPay] Retorno 200 sem campo pix.code esperado:', data);
  }

  return {
    success: true,
    transactionId: data.transactionId,
    status: data.status, // "OK" | "PENDING"
    transactionStatus: data.transactionStatus || 'PENDING',
    webhookToken: data.webhookToken,
    fee: data.fee,
    order: data.order,
    pix: {
      code: data.pix?.code || '',
      image: data.pix?.image || '',
      base64: data.pix?.base64 || '',
      expiresAt: data.pix?.expiresAt || null
    },
    raw: data
  };
}

module.exports = {
  getCredentials,
  createPixCharge,
  cleanDigits,
  formatCpf
};

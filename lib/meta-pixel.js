const crypto = require('crypto');
const { updateOrderStatus, getOrder } = require('./orders');

const META_PIXEL_ID = process.env.META_PIXEL_ID || '954239554398396';
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN || 'EAARa5slDBT0BSm4057AJ0tRAYivLy5Lcsb8ELd3owUZCZA58PBrPaKjqiJ0NjitGTVNVpvvfM63ZBLqwCa6Lz83OM0DmSABD7e4EFmweLQbqljDPZB8YLGZBnGFTTzVebnA2c8tbK04HvhRtOitnT3aYmUoBFrX0zOUo73hu0dgat9WtPLuoHaKPMZB7zMXgZDZD';

/**
 * Standard SHA-256 hash for Meta CAPI
 */
function hashField(value) {
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return null;
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

/**
 * Format phone to international digits without '+' or symbols
 */
function normalizePhone(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  if (!digits) return null;
  // If Brazilian number without country code, add 55
  if (digits.length === 10 || digits.length === 11) {
    return '55' + digits;
  }
  return digits;
}

/**
 * Sends a Purchase event to Meta Conversions API (CAPI)
 * Implements strict anti-duplication guards
 */
/**
 * Sends a PageView event to Meta Conversions API (CAPI)
 * Call this server-side when a user loads a page, using the same
 * eventID as the front-end fbq('track', 'PageView', {}, { eventID }) for deduplication.
 */
async function sendMetaPageViewEvent({ eventId, pageUrl, reqContext = {} }) {
  const userData = {};

  if (reqContext.clientIp) {
    userData.client_ip_address = reqContext.clientIp;
  }
  if (reqContext.userAgent) {
    userData.client_user_agent = reqContext.userAgent;
  }
  if (reqContext.fbp) {
    userData.fbp = reqContext.fbp;
  }
  if (reqContext.fbc) {
    userData.fbc = reqContext.fbc;
  }

  const payload = {
    data: [
      {
        event_name: 'PageView',
        event_time: Math.floor(Date.now() / 1000),
        event_id: eventId,
        action_source: 'website',
        event_source_url: pageUrl || '',
        user_data: userData
      }
    ]
  };

  const endpoint = `https://graph.facebook.com/v19.0/${META_PIXEL_ID}/events?access_token=${META_ACCESS_TOKEN}`;

  console.log(`[Meta CAPI] Disparando evento PageView (event_id: ${eventId}, url: ${pageUrl})...`);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const resJson = await response.json();

    if (!response.ok) {
      console.error('[Meta CAPI] Erro retornado pela Meta API (PageView):', resJson);
      return { success: false, error: resJson.error };
    }

    console.log(`[Meta CAPI] PageView confirmado pela Meta (event_id: ${eventId}):`, resJson);
    return { success: true, event_id: eventId, result: resJson };
  } catch (err) {
    console.error('[Meta CAPI] Erro de rede ao enviar PageView:', err);
    return { success: false, error: err.message };
  }
}

async function sendMetaPurchaseEvent(orderInput, reqContext = {}) {
  if (!orderInput) return { success: false, reason: 'order_missing' };

  // Always retrieve the latest order record to check if purchase was already sent
  const order = getOrder(orderInput.identifier) || orderInput;

  // Anti-duplication check: NEVER send purchase twice for the same order
  if (order.metaPurchaseSent) {
    console.log(`[Meta CAPI] Evento Purchase já enviado para ${order.identifier}. Disparo duplicado evitado.`);
    return { success: true, duplicated: true, event_id: order.identifier };
  }

  const client = order.client || {};
  const shipping = order.shipping || {};

  // User data for Meta matching
  const userData = {};

  if (client.email) {
    userData.em = [hashField(client.email)];
  }

  if (client.phone) {
    const normPhone = normalizePhone(client.phone);
    if (normPhone) {
      userData.ph = [hashField(normPhone)];
    }
  }

  if (client.name) {
    const parts = client.name.trim().split(/\s+/);
    if (parts[0]) userData.fn = [hashField(parts[0])];
    if (parts.length > 1) userData.ln = [hashField(parts[parts.length - 1])];
  }

  if (shipping.city) {
    userData.ct = [hashField(shipping.city)];
  }
  if (shipping.uf) {
    userData.st = [hashField(shipping.uf)];
  }
  if (shipping.cep) {
    userData.zp = [hashField(String(shipping.cep).replace(/\D/g, ''))];
  }
  userData.country = [hashField('br')];

  const fbp = reqContext.fbp || order.fbp;
  if (fbp) {
    userData.fbp = fbp;
  }

  let fbc = reqContext.fbc || order.fbc;
  if (!fbc && (order.utm?.fbclid || order.fbclid)) {
    const fbclid = order.utm?.fbclid || order.fbclid;
    fbc = `fb.1.${Math.floor(Date.now() / 1000)}.${fbclid}`;
  }
  if (fbc) {
    userData.fbc = fbc;
  }

  const clientIp = reqContext.clientIp || order.clientIp;
  if (clientIp) {
    userData.client_ip_address = clientIp;
  }

  const userAgent = reqContext.userAgent || order.userAgent;
  if (userAgent) {
    userData.client_user_agent = userAgent;
  }

  const amountVal = Number(Number(order.amount || 217.90).toFixed(2));

  // Event ID must match the front-end eventID for Meta deduplication!
  const eventId = order.identifier;

  const payload = {
    data: [
      {
        event_name: 'Purchase',
        event_time: Math.floor(Date.now() / 1000),
        event_id: eventId,
        action_source: 'website',
        user_data: userData,
        custom_data: {
          currency: 'BRL',
          value: amountVal,
          content_type: 'product',
          content_name: 'Tênis Nike Court Vision Low Next Nature Masculino - Preto',
          content_ids: ['nike-court-vision-low-next-nature'],
          num_items: 1,
          order_id: eventId
        }
      }
    ]
  };

  const endpoint = `https://graph.facebook.com/v19.0/${META_PIXEL_ID}/events?access_token=${META_ACCESS_TOKEN}`;

  console.log(`[Meta CAPI] Disparando evento Purchase para pedido ${eventId} (Valor: R$ ${amountVal})...`);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const resJson = await response.json();

    if (!response.ok) {
      console.error('[Meta CAPI] Erro retornado pela Meta API:', resJson);
      return { success: false, error: resJson.error };
    }

    // Mark as sent in order database so it will NEVER be sent again
    updateOrderStatus(order.identifier, order.status || 'PAID', {
      metaPurchaseSent: true,
      metaPurchaseSentAt: new Date().toISOString(),
      metaResponse: resJson
    });

    console.log(`[Meta CAPI] Evento Purchase confirmado pela Meta para ${eventId}:`, resJson);
    return { success: true, event_id: eventId, result: resJson };
  } catch (err) {
    console.error('[Meta CAPI] Erro de rede ao enviar evento:', err);
    return { success: false, error: err.message };
  }
}

module.exports = {
  META_PIXEL_ID,
  META_ACCESS_TOKEN,
  hashField,
  normalizePhone,
  sendMetaPageViewEvent,
  sendMetaPurchaseEvent
};

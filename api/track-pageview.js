const { sendMetaPageViewEvent } = require('../lib/meta-pixel');

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status ? res.status(200).end() : (res.writeHead(200), res.end());
  }

  if (req.method !== 'POST') {
    if (res.status) return res.status(405).json({ error: 'Método não permitido.' });
    res.writeHead(405, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Método não permitido.' }));
  }

  try {
    const body = typeof req.body === 'object' && req.body !== null
      ? req.body
      : JSON.parse(req.body || '{}');

    const { event_id, page_url, fbp, fbc } = body;

    if (!event_id) {
      if (res.status) return res.status(400).json({ error: 'event_id é obrigatório.' });
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'event_id é obrigatório.' }));
    }

    // Capture browser context from request headers
    const clientIp =
      req.headers['x-forwarded-for']?.split(',')[0].trim() ||
      req.socket?.remoteAddress ||
      '';
    const userAgent = req.headers['user-agent'] || '';

    const result = await sendMetaPageViewEvent({
      eventId: event_id,
      pageUrl: page_url || '',
      reqContext: { clientIp, userAgent, fbp, fbc }
    });

    const responsePayload = { success: result.success, event_id };

    if (res.status) return res.status(200).json(responsePayload);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(responsePayload));
  } catch (err) {
    console.error('[api/track-pageview] Erro:', err);
    if (res.status) return res.status(500).json({ error: err.message });
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
};

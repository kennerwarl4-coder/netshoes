const http = require('http');
const fs = require('fs');
const path = require('path');

// Automatically load .env if it exists (Node.js 20.6+)
try {
  if (fs.existsSync(path.join(__dirname, '.env'))) {
    if (typeof process.loadEnvFile === 'function') {
      process.loadEnvFile(path.join(__dirname, '.env'));
    }
  }
} catch (envErr) {
  console.warn('[server] Notice loading .env:', envErr.message);
}

const PORT = process.env.PORT || 3000;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

// API Handlers
const apiHandlers = {
  '/api/create-pix': require('./api/create-pix'),
  '/api/webhook': require('./api/webhook'),
  '/api/check-status': require('./api/check-status'),
  '/api/simulate-payment': require('./api/simulate-payment')
};

async function handleApiRequest(req, res, pathname) {
  const handler = apiHandlers[pathname];
  if (!handler) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Endpoint API não encontrado.' }));
    return;
  }

  // Parse query string
  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  req.query = Object.fromEntries(urlObj.searchParams.entries());

  // Enhance res with Express/Vercel-like helpers
  res.status = function (code) {
    res.statusCode = code;
    return {
      json: function (obj) {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(obj));
      },
      end: function (data) {
        res.end(data);
      }
    };
  };

  res.json = function (obj) {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(obj));
  };

  // Read request body for POST/PUT/PATCH
  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    let bodyData = '';
    req.on('data', chunk => {
      bodyData += chunk;
    });
    req.on('end', async () => {
      try {
        req.body = bodyData ? JSON.parse(bodyData) : {};
      } catch {
        req.body = bodyData;
      }
      try {
        await handler(req, res);
      } catch (err) {
        console.error(`[API Error] ${pathname}:`, err);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      }
    });
  } else {
    req.body = {};
    try {
      await handler(req, res);
    } catch (err) {
      console.error(`[API Error] ${pathname}:`, err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    }
  }
}

const server = http.createServer((req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = urlObj.pathname;

  // Route API endpoints
  if (pathname.startsWith('/api/')) {
    return handleApiRequest(req, res, pathname);
  }

  // Route static files
  let reqPath = decodeURI(pathname);
  if (reqPath === '/') reqPath = '/index.html';
  if (reqPath === '/checkout') reqPath = '/checkout.html';

  const filePath = path.join(__dirname, reqPath);

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*'
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`\n🚀 Servidor Court Vision rodando em http://localhost:${PORT}/`);
  console.log(`💳 Checkout: http://localhost:${PORT}/checkout`);
  console.log(`⚡ API Pix SigiloPay: http://localhost:${PORT}/api/create-pix\n`);
});

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'orders.json');

// In-memory cache for fast lookups and serverless fallbacks
const ordersMemory = new Map();

function ensureDataFile() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(DATA_FILE)) {
      fs.writeFileSync(DATA_FILE, JSON.stringify({}, null, 2), 'utf-8');
    }
  } catch {
    // Read-only filesystem in some serverless environments
  }
}

function loadOrders() {
  try {
    ensureDataFile();
    if (fs.existsSync(DATA_FILE)) {
      const data = fs.readFileSync(DATA_FILE, 'utf-8');
      const json = JSON.parse(data || '{}');
      for (const [key, val] of Object.entries(json)) {
        ordersMemory.set(key, val);
      }
    }
  } catch (err) {
    console.warn('[orders] Warning loading data file:', err.message);
  }
}

function persistOrders() {
  try {
    ensureDataFile();
    const obj = {};
    for (const [key, val] of ordersMemory.entries()) {
      obj[key] = val;
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify(obj, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[orders] Warning persisting to disk (using memory):', err.message);
  }
}

// Initial load
loadOrders();

function saveOrder(order) {
  if (!order || !order.identifier) {
    throw new Error('Order must have an identifier');
  }
  const now = new Date().toISOString();
  const existing = ordersMemory.get(order.identifier) || {};
  const record = {
    ...existing,
    ...order,
    updatedAt: now,
    createdAt: existing.createdAt || order.createdAt || now
  };

  ordersMemory.set(order.identifier, record);
  if (record.transactionId) {
    ordersMemory.set('tx_' + record.transactionId, record);
  }

  persistOrders();
  return record;
}

function findInCache(identifierOrTxId) {
  const direct = ordersMemory.get(identifierOrTxId);
  if (direct) return direct;

  const byTx = ordersMemory.get('tx_' + identifierOrTxId);
  if (byTx) return byTx;

  for (const val of ordersMemory.values()) {
    if (val.identifier === identifierOrTxId ||
        val.transactionId === identifierOrTxId ||
        (val.order && val.order.id === identifierOrTxId)) {
      return val;
    }
  }
  return null;
}

function getOrder(identifierOrTxId) {
  if (!identifierOrTxId) return null;
  
  let found = findInCache(identifierOrTxId);
  if (found) return found;

  // If not found in memory, try refreshing from disk (multi-process / worker sync)
  loadOrders();
  return findInCache(identifierOrTxId);
}

function updateOrderStatus(identifierOrTxId, status, extra = {}) {
  const order = getOrder(identifierOrTxId);
  if (!order) {
    console.warn(`[orders] Order not found for identifier/txId: ${identifierOrTxId}`);
    return null;
  }

  order.status = status;
  order.updatedAt = new Date().toISOString();
  Object.assign(order, extra);

  saveOrder(order);
  return order;
}

function listOrders() {
  const list = [];
  const seen = new Set();
  for (const [k, v] of ordersMemory.entries()) {
    if (k.startsWith('tx_')) continue;
    if (!seen.has(v.identifier)) {
      seen.add(v.identifier);
      list.push(v);
    }
  }
  return list;
}

module.exports = {
  saveOrder,
  getOrder,
  updateOrderStatus,
  listOrders
};

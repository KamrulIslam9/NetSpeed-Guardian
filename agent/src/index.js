'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { EventEmitter } = require('events');
const fetch = require('node-fetch');
const Admin = require('firebase-admin');
const WhatsAppLinkedDevice = require('./whatsapp');

// ──────────────────────────────────────────────────────────────────────
// Config
// ──────────────────────────────────────────────────────────────────────
const config = require('./config');

const dataDir = config.storagePath;
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// ──────────────────────────────────────────────────────────────────────
// WhatsApp Linked Device Init
// ──────────────────────────────────────────────────────────────────────
const whatsappManager = new WhatsAppLinkedDevice(dataDir);
whatsappManager.init().catch(e => console.error('WhatsApp init error:', e));

// ──────────────────────────────────────────────────────────────────────
// Firebase init
// ──────────────────────────────────────────────────────────────────────
let firebaseApp;
try {
  if (config.firebase.credentialPath && fs.existsSync(config.firebase.credentialPath)) {
    const cred = Admin.credential.cert(require(config.firebase.credentialPath));
    firebaseApp = Admin.initializeApp({ credential: Admin.credential.cert(cred) });
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS && fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
    firebaseApp = Admin.initializeApp();
  } else {
    console.warn('⚠️  Firebase credentials not configured; Firebase features disabled in agent.');
  }
} catch (e) {
  console.warn('⚠️  Firebase init error:', e.message);
}

const db = firebaseApp ? Admin.firestore(firebaseApp) : null;

// ──────────────────────────────────────────────────────────────────────
// State
// ──────────────────────────────────────────────────────────────────────
const state = {
  monitoring: false,
  lastDownloadMbps: null,
  lastUploadMbps: null,
  lastLatencyMs: null,
  lastSpeedTestAt: null,
  lastAlertSentAt: null,
  config: { ...config },
};

const emitter = new EventEmitter();

// ──────────────────────────────────────────────────────────────────────
// Speed test helpers
// ──────────────────────────────────────────────────────────────────────
async function downloadBytes(url, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const response = await fetch(url, { signal: controller.signal });
  clearTimeout(timeoutId);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const total = 0;
  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
  }
  return total;
}

async function measureDownload(url, timeoutMs) {
  const t0 = performance.now();
  const bytes = await downloadBytes(url, timeoutMs);
  const elapsedSec = (performance.now() - t0) / 1000;
  if (elapsedSec <= 0) throw new Error('Zero elapsed time');
  const mbps = (bytes * 8) / (elapsedSec * 1_000_000);
  return mbps / 8; // MB/s
}

async function measureUpload(url, sizeBytes, timeoutMs) {
  const content = Buffer.alloc(sizeBytes, Math.random() * 256);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const start = performance.now();
  const response = await fetch(url, {
    method: 'POST',
    body: content,
    headers: { 'Content-Type': 'application/octet-stream' },
    signal: controller.signal,
  });
  clearTimeout(timeoutId);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const elapsedSec = (performance.now() - start) / 1000;
  if (elapsedSec <= 0) throw new Error('Zero elapsed time');
  const mbps = (content.length * 8) / (elapsedSec * 1_000_000);
  return mbps / 8;
}

async function measureLatency(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  const start = performance.now();
  await fetch(url, { signal: controller.signal });
  clearTimeout(timeoutId);
  return performance.now() - start;
}

async function runSpeedTest({ downloadUrl, uploadUrl, sampleSizeBytes, timeoutMs }) {
  const downloadMbps = await measureDownload(downloadUrl, timeoutMs);
  let uploadMbps = null;
  try { uploadMbps = await measureUpload(uploadUrl, sampleSizeBytes, timeoutMs); } catch (e) {}
  let latencyMs = null;
  try { latencyMs = await measureLatency(downloadUrl); } catch (e) {}
  return {
    downloadMbps,
    uploadMbps,
    latencyMs: latencyMs ? Math.round(latencyMs) : null,
    testAt: new Date().toISOString(),
  };
}

// ──────────────────────────────────────────────────────────────────────
// WhatsApp Alert via Linked Device
// ──────────────────────────────────────────────────────────────────────
async function sendWhatsAppAlert(config, speedResult) {
  const { downloadMbps, uploadMbps, latencyMs, testAt } = speedResult;
  const threshold = config.alertThresholdMBs;
  const currentDownloadMbps = downloadMbps;
  const packageSpeed = config.packageSpeedMBs;

  const now = Date.now();
  if (state.lastAlertSentAt !== null) {
    const elapsed = now - state.lastAlertSentAt;
    if (elapsed < config.cooldownSeconds * 1000) {
      console.log(`ℹ️  Alert cooldown active (${Math.round(elapsed / 1000)}s remaining)`);
      return { status: 'cooldown', sent: false };
    }
  }

  if (currentDownloadMbps >= threshold) {
    return { status: 'above-threshold', sent: false };
  }

  const message = config.message
    .replace('{package_speed}', packageSpeed.toString())
    .replace('{current_speed}', currentDownloadMbps.toFixed(2));

  try {
    await whatsappManager.sendMessage(config.providerWhatsApp, message);
    state.lastAlertSentAt = now;

    if (db) {
      try {
        await db.collection('alerts').add({
          providerWhatsApp: config.providerWhatsApp,
          packageSpeedMBs: packageSpeed,
          alertThresholdMBs: threshold,
          downloadMbps: currentDownloadMbps,
          uploadMbps,
          latencyMs,
          testAt,
          message,
          status: 'sent',
          createdAt: Admin.firestore.FieldValue.serverTimestamp(),
        });
      } catch (e) {}
    }

    emitter.emit('alert-sent', { status: 'sent', message });
    return { status: 'sent' };
  } catch (err) {
    console.error('❌ WhatsApp alert failed:', err.message);
    emitter.emit('alert-failed', { error: err.message });
    return { status: 'failed', error: err.message };
  }
}

// ──────────────────────────────────────────────────────────────────────
// HTTP + WebSocket Server
// ──────────────────────────────────────────────────────────────────────
function createServer() {
  const server = http.createServer(async (req, res) => {
    // CORS headers for frontend integration
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        monitoring: state.monitoring,
        lastDownloadMbps: state.lastDownloadMbps,
        whatsapp: whatsappManager.getStatus(),
        uptime: process.uptime(),
      }));
      return;
    }

    // WhatsApp Linked Device Status & QR
    if (url.pathname === '/whatsapp/status' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(whatsappManager.getStatus()));
      return;
    }

    if (url.pathname === '/whatsapp/logout' && req.method === 'POST') {
      const result = await whatsappManager.logout();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }

    if (url.pathname === '/config' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ...state.config, lastAlertSentAt: state.lastAlertSentAt }));
      return;
    }

    if (url.pathname === '/config' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const updates = JSON.parse(body);
          state.config = { ...state.config, ...updates };
          fs.writeFileSync(path.join(dataDir, 'agent-config.json'), JSON.stringify(state.config, null, 2));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, config: state.config }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
      return;
    }

    if (url.pathname === '/test' && req.method === 'POST') {
      try {
        const result = await runSpeedTest(config.speedTest);
        state.lastDownloadMbps = result.downloadMbps;
        state.lastUploadMbps = result.uploadMbps;
        state.lastLatencyMs = result.latencyMs;
        state.lastSpeedTestAt = result.testAt;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    if (url.pathname === '/start-monitoring' && req.method === 'POST') {
      state.monitoring = true;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, monitoring: true }));
      return;
    }

    if (url.pathname === '/stop-monitoring' && req.method === 'POST') {
      state.monitoring = false;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, monitoring: false }));
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  const ws = new (require('ws').Server)({ server, path: '/ws' });
  ws.on('connection', socket => {
    socket.send(JSON.stringify({
      type: 'state',
      data: {
        monitoring: state.monitoring,
        lastDownloadMbps: state.lastDownloadMbps,
        whatsapp: whatsappManager.getStatus(),
        config: state.config,
      },
    }));
  });

  return server;
}

// ──────────────────────────────────────────────────────────────────────
// Monitoring Loop
// ──────────────────────────────────────────────────────────────────────
async function monitoringLoop() {
  while (true) {
    if (state.monitoring) {
      try {
        const result = await runSpeedTest(config.speedTest);
        state.lastDownloadMbps = result.downloadMbps;
        state.lastUploadMbps = result.uploadMbps;
        state.lastLatencyMs = result.latencyMs;
        state.lastSpeedTestAt = result.testAt;

        if (result.downloadMbps < state.config.alertThresholdMBs) {
          await sendWhatsAppAlert(state.config, result);
        }
      } catch (e) {
        console.error('Monitoring loop error:', e.message);
      }
    }
    await new Promise(r => setTimeout(r, (state.config.intervalSeconds || 60) * 1000));
  }
}

// ──────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────
async function start() {
  const server = createServer();
  server.listen(config.port, config.host, () => {
    console.log(`🚀 NetSpeed Guardian Agent running on http://${config.host}:${config.port}`);
  });
  monitoringLoop().catch(console.error);
}

start();
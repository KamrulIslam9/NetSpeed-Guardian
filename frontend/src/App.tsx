import React, { useState, useEffect, useRef } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import './App.css';

// ─── API helper ──────────────────────────────────────────────────────
const API = axios.create({ baseURL: '/api' });

// ─── Config form state ───────────────────────────────────────────────
const defaultConfig = {
  userWhatsApp: '+8801581955035',
  providerWhatsApp: '+8801849350702',
  packageSpeedMBs: 20,
  alertThresholdMBs: 5,
  message:
    'Hello, I am experiencing slow internet speed with my Wi-Fi connection. My subscribed package speed is {package_speed} MB/s, but my current download speed is only {current_speed} MB/s. Please investigate and resolve this issue as soon as possible. Thank you.',
  intervalSeconds: 60,
};

// ─── Dashboard components ────────────────────────────────────────────
function ConfigForm({ onSubmit }) {
  const [form, setForm] = useState({ ...defaultConfig });
  const [status, setStatus] = useState('');

  useEffect(() => {
    // Load config from agent
    API.get('/config').then(r => setForm(r.data)).catch(() => setForm({ ...defaultConfig }));
  }, []);

  const handleChange = e =>
    setForm({ ...form, [e.target.name]: e.target.type === 'textarea' ? e.target.value : Number(e.target.value) });

  const handleSubmit = async e => {
    e.preventDefault();
    await onSubmit(form);
    setStatus('✅ Config saved');
    setTimeout(() => setStatus(''), 3000);
  };

  return (
    <section className="config-card">
      <h2>⚙️ Configuration</h2>
      {status && <p>{status}</p>}
      <form onSubmit={handleSubmit}>
        <div>
          <label>Your WhatsApp Number</label>
          <input
            name="userWhatsApp"
            type="tel"
            value={form.userWhatsApp}
            onChange={handleChange}
            placeholder="+8801581955035"
            required
          />
        </div>
        <div>
          <label>Wi-Fi Provider WhatsApp Number</label>
          <input
            name="providerWhatsApp"
            type="tel"
            value={form.providerWhatsApp}
            onChange={handleChange}
            placeholder="+8801849350702"
            required
          />
        </div>
        <div>
          <label>Your Wi-Fi Package Speed (MB/s)</label>
          <input
            name="packageSpeedMBs"
            type="number"
            value={form.packageSpeedMBs}
            onChange={handleChange}
            min="0.1"
            step="0.1"
          />
        </div>
        <div>
          <label>Send Alert When Speed Drops Below (MB/s)</label>
          <input
            name="alertThresholdMBs"
            type="number"
            value={form.alertThresholdMBs}
            onChange={handleChange}
            min="0.1"
            step="0.1"
          />
        </div>
        <div>
          <label>Message to Your Wi-Fi Provider</label>
          <textarea
            name="message"
            rows={4}
            value={form.message}
            onChange={handleChange}
            placeholder="Hello, I am experiencing slow internet...">
          </textarea>
        </div>
        <button type="submit" className="btn-primary">Save Configuration</button>
      </form>
    </section>
  );
}

function Speedometer({ downloadMbps, uploadMbps, latencyMs, isConnected }) {
  const getStatusColor = speed => {
    if (!isConnected) return 'var(--gray)';
    if (speed < 1) return 'var(--red)';
    if (speed < 5) return 'var(--yellow)';
    return 'var(--green)';
  };

  const downloadColor = getStatusColor(downloadMbps);
  const uploadColor = getStatusColor(uploadMbps);

  return (
    <div className="speedometer">
      <h3>📡 Live Speedometer</h3>
      <div className="svg-container">
        <svg width="200" height="200" viewBox="0 0 100 100">
          <circle
            cx="50"
            cy="50"
            r="45"
            stroke="var(--bg-color)"
            strokeWidth="8"
            fill="none"
          />
          <circle
            cx="50"
            cy="50"
            r="45"
            stroke={downloadColor}
            strokeWidth="8"
            fill="none"
            style={{ strokeDasharray: '113', strokeDashoffset: 113 - (downloadMbps / 20) * 113 || 0, transition: 'stroke-dashoffset 0.3s' }}
          />
          <text x="50" y="55" textAnchor="middle" fill="var(--text)" fontSize="14" dy=".3em">
            {downloadMbps !== undefined ? downloadMbps.toFixed(1) : '—'} MB/s
          </text>
          <text x="50" y="95" textAnchor="middle" fill="var(--text)" fontSize="11" dy=".3em">
            Download
          </text>
        </svg>
        <svg width="200" height="200" viewBox="0 0 100 100">
          <circle
            cx="50"
            cy="50"
            r="45"
            stroke="var(--bg-color)"
            strokeWidth="8"
            fill="none"
          />
          <circle
            cx="50"
            cy="50"
            r="45"
            stroke={uploadColor}
            strokeWidth="8"
            fill="none"
            style={{ strokeDasharray: '113', strokeDashoffset: 113 - (uploadMbps / 20) * 113 || 0, transition: 'stroke-dashoffset 0.3s' }}
          />
          <text x="50" y="55" textAnchor="middle" fill="var(--text)" fontSize="14" dy=".3em">
            {uploadMbps !== undefined ? uploadMbps.toFixed(1) : '—'} MB/s
          </text>
          <text x="50" y="95" textAnchor="middle" fill="var(--text)" fontSize="11" dy=".3em">
            Upload
          </text>
        </svg>
      </div>
      {latencyMs !== undefined && (
        <p>🕒 Latency: {latencyMs} ms</p>
      )}
    </div>
  );
}

function HistoryList({ speedTests }) {
  if (!speedTests.length) return null;
  return (
    <div>
      <h3>📊 Last 10 Speed Tests</h3>
      <ul>
        {speedTests
          .sort((a, b) => new Date(b.testAt) - new Date(a.testAt))
          .slice(0, 10)
          .map((t, i) => (
            <li key={i} style={{ marginBottom: '8px', fontSize: '0.9rem' }}>
              {new Date(t.testAt).toLocaleTimeString()} — ↓{t.downloadMbps?.toFixed(2)} MB/s ↑{t.uploadMbps?.toFixed(2)} MB/s
            </li>
          ))}
      </ul>
    </div>
  );
}

function AlertsList({ alerts }) {
  if (!alerts.length) return null;
  return (
    <div>
      <h3>📤 WhatsApp Alert History</h3>
      <ul>
        {alerts
          .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
          .slice(0, 10)
          .map((a, i) => (
            <li key={i} style={{ marginBottom: '8px', fontSize: '0.9rem' }}>
              {new Date(a.createdAt).toLocaleTimeString()} — {a.status}: {a.downloadMbps?.toFixed(2)} MB/s
            </li>
          ))}
      </ul>
    </div>
  );
}

// ─── Main App ────────────────────────────────────────────────────────
export default function App() {
  const navigate = useNavigate();
  const [monitoring, setMonitoring] = useState(false);
  const [downloadMbps, setDownloadMbps] = useState(null);
  const [uploadMbps, setUploadMbps] = useState(null);
  const [latencyMs, setLatencyMs] = useState(null);
  const [config, setConfig] = useState({ ...defaultConfig });
  const [speedTests, setSpeedTests] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const wsRef = useRef(null);

  // Connect to agent WebSocket
  useEffect(() => {
    const ws = new WebSocket(`ws://${window.location.host}/ws`);
    wsRef.current = ws;
    ws.onopen = () => console.log('🔌 WS connected');
    ws.onmessage = e => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'state') {
        setMonitoring(msg.data.monitoring);
        setDownloadMbps(msg.data.lastDownloadMbps);
        setUploadMbps(msg.data.lastUploadMbps);
        setLatencyMs(msg.data.lastLatencyMs);
        setConfig(msg.data.config);
        setSpeedTests(msg.data.speedTests || []);
        setAlerts(msg.data.alerts || []);
      }
    };
    ws.onerror = e => console.error('❌ WS error:', e);
    return () => ws.close();
  }, []);

  // Poll config + history every 5s when monitoring
  useEffect(() => {
    if (!monitoring) return;
    const poll = setInterval(async () => {
      try {
        const [c, st, al] = await Promise.all([
          API.get('/config'),
          API.get('/history'),
          API.get('/alerts'),
        ]);
        setConfig(c.data);
        setSpeedTests(st.data);
        setAlerts(al.data);
      } catch (e) {
        console.warn('⚠️  Poll failed:', e.message);
      }
    }, 5000);
    return () => clearInterval(poll);
  }, [monitoring]);

  // Start monitoring
  const startMonitoring = async () => {
    // Validate
    if (!config.userWhatsApp || !config.providerWhatsApp) {
      alert('Please set both WhatsApp numbers first');
      return;
    }
    await API.post('/test'); // prime the speed test
    await API.post('/start-monitoring');
    setMonitoring(true);
  };

  const stopMonitoring = async () => {
    await API.post('/stop-monitoring');
    setMonitoring(false);
  };

  return (
    <Router>
      <div className="app">
        <nav>
          <Link to="/" style={{ marginRight: '24px', color: 'var(--text)' }}>Dashboard</Link>
          <Link to="/config" style={{ color: 'var(--text)' }}>Config</Link>
        </nav>
        <main>
          <Routes>
            <Route path="/" element={
              <div style={{ padding: '24px' }}>
                <ConfigForm onSubmit={async cfg => {
                  await API.post('/config', cfg);
                  await startMonitoring();
                }} />
                <Speedometer
                  downloadMbps={downloadMbps}
                  uploadMbps={uploadMbps}
                  latencyMs={latencyMs}
                  isConnected={monitoring}
                />
                <div style={{ marginTop: '24px', fontSize: '1.2rem' }}>
                  {monitoring ? (
                    <>
                      <span>Status: 🟢 Monitoring active</span>
                      <button onClick={stopMonitoring} className="btn-secondary" style={{ marginLeft: '16px' }}>Stop Monitoring</button>
                    </>
                  ) : (
                    <button onClick={startMonitoring} className="btn-primary">
                      START MONITORING
                    </button>
                  )}
                </div>
              </div>
            } />
            <Route path="/config" element={<ConfigForm onSubmit={async cfg => API.post('/config', cfg)} />} />
            <Route path="/history" element={
              <div style={{ padding: '24px' }}>
                <HistoryList speedTests={speedTests} />
                <AlertsList alerts={alerts} />
                <br />
                <button onClick={() => navigate('/')} style={{ marginTop: '16px' }}>← Back to Dashboard</button>
              </div>
            } />
          </Routes>
        </main>
      </div>
    </Router>
  );
}
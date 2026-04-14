require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { WebSocketServer } = require('ws');
const http = require('http');
const mqttClient = require('./mqtt/mqttClient');
const { initDB, getLatestReadings, getHistory, getAllHistory, getAlerts, getStats, persistDB } = require('./store/dataStore');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

function broadcast(data) {
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(JSON.stringify(data));
  });
}
global.broadcast = broadcast;

wss.on('connection', (ws) => {
  console.log('Dashboard client connected');
  ws.send(JSON.stringify({ type: 'init', data: getLatestReadings() }));
  ws.send(JSON.stringify({ type: 'history', data: getAllHistory(200) }));
});

// ─── REST API ─────────────────────────────────────────────────────────────────
app.get('/api/readings',     (req, res) => res.json(getLatestReadings()));
app.get('/api/history',      (req, res) => res.json(getHistory(req.query.sensor, parseInt(req.query.limit || 100), req.query.deviceId)));
app.get('/api/history/all',  (req, res) => res.json(getAllHistory(parseInt(req.query.limit || 500))));
app.get('/api/alerts',       (req, res) => res.json(getAlerts(parseInt(req.query.limit || 100))));
app.get('/api/stats',        (req, res) => res.json(getStats()));
app.get('/api/status',       (req, res) => res.json({ status: 'online', timestamp: new Date().toISOString() }));

app.delete('/api/cleanup', (req, res) => {
  const { persistDB: save } = require('./store/dataStore');
  // handled inline
  res.json({ message: 'Use database directly' });
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

initDB().then(() => {
  server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    mqttClient.connect();
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});

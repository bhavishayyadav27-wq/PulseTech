require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { WebSocketServer } = require('ws');
const http = require('http');
const mqttClient = require('./mqtt/mqttClient');
const { getLatestReadings, getHistory, getAllHistory, getAlerts, getStats } = require('./store/dataStore');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Broadcast to all connected WebSocket clients
function broadcast(data) {
  wss.clients.forEach(client => {
    if (client.readyState === 1) {
      client.send(JSON.stringify(data));
    }
  });
}
global.broadcast = broadcast;

wss.on('connection', (ws) => {
  console.log('Dashboard client connected');
  // Send current state immediately on connect
  ws.send(JSON.stringify({ type: 'init', data: getLatestReadings() }));
  // Send recent history for charts
  ws.send(JSON.stringify({ type: 'history', data: getAllHistory(200) }));
});

// ─── REST API ─────────────────────────────────────────────────────────────────

// Latest reading per device
app.get('/api/readings', (req, res) => {
  res.json(getLatestReadings());
});

// Historical data — ?sensor=soilMoisture&limit=100&deviceId=field-01
app.get('/api/history', (req, res) => {
  const { sensor, limit = 100, deviceId } = req.query;
  res.json(getHistory(sensor, parseInt(limit), deviceId));
});

// All history for dashboard charts
app.get('/api/history/all', (req, res) => {
  const { limit = 500 } = req.query;
  res.json(getAllHistory(parseInt(limit)));
});

// Alerts log
app.get('/api/alerts', (req, res) => {
  const { limit = 100 } = req.query;
  res.json(getAlerts(parseInt(limit)));
});

// Stats
app.get('/api/stats', (req, res) => {
  res.json(getStats());
});

// Health check
app.get('/api/status', (req, res) => {
  res.json({ status: 'online', timestamp: new Date().toISOString() });
});

// One-time cleanup — removes readings with invalid timestamps
app.delete('/api/cleanup', (req, res) => {
  const db = require('./store/dataStore');
  // We access the db directly here
  const Database = require('better-sqlite3');
  const path = require('path');
  const d = new Database(path.join(__dirname, 'data/agri.db'));
  const result = d.prepare(`DELETE FROM readings WHERE timestamp < '2020-01-01'`).run();
  d.close();
  res.json({ deleted: result.changes });
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`WebSocket ready`);
  mqttClient.connect();
});

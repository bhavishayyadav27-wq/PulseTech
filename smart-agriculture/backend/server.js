require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { WebSocketServer } = require('ws');
const http = require('http');
const mqttClient = require('./mqtt/mqttClient');
const { getLatestReadings, getHistory, getAlerts } = require('./store/dataStore');

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

// Expose broadcast so MQTT client can use it
global.broadcast = broadcast;

wss.on('connection', (ws) => {
  console.log('Dashboard client connected');
  // Send current state on connect
  ws.send(JSON.stringify({ type: 'init', data: getLatestReadings() }));
});

// REST API Routes
app.get('/api/readings', (req, res) => {
  res.json(getLatestReadings());
});

app.get('/api/history', (req, res) => {
  const { sensor, limit = 50 } = req.query;
  res.json(getHistory(sensor, parseInt(limit)));
});

app.get('/api/alerts', (req, res) => {
  res.json(getAlerts());
});

app.get('/api/status', (req, res) => {
  res.json({ status: 'online', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`WebSocket server ready`);
  mqttClient.connect();
});

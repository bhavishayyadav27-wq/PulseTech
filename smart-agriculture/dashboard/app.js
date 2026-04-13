const WS_URL = 'ws://localhost:3000';
const API_URL = 'http://localhost:3000/api';

// State
let selectedDevice = null;
let devices = {};
let historyData = { soilMoisture: [], temperature: [], humidity: [], light: [] };
let charts = {};
let ws;

// Thresholds for UI status
const THRESHOLDS = {
  soilMoisture: { low: 30, high: 80 },
  temperature: { high: 35 },
  humidity: { low: 40, high: 90 },
  light: { low: 200 },
};

// ─── WebSocket ────────────────────────────────────────────────────────────────
function connectWS() {
  ws = new WebSocket(WS_URL);

  ws.onopen = () => setConnectionStatus(true);
  ws.onclose = () => {
    setConnectionStatus(false);
    setTimeout(connectWS, 3000);
  };
  ws.onerror = () => setConnectionStatus(false);

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === 'init') {
      msg.data.forEach(r => processReading(r));
    } else if (msg.type === 'history') {
      msg.data.forEach(r => processReading(r, true));
    } else if (msg.type === 'sensorUpdate') {
      processReading(msg.data);
    } else if (msg.type === 'alert') {
      addAlertToUI(msg.data);
    } else if (msg.type === 'deviceStatus') {
      updateDeviceStatus(msg.deviceId, msg.data);
    }
  };
}

function setConnectionStatus(online) {
  const el = document.getElementById('connection-status');
  el.textContent = online ? '● Connected' : '● Disconnected';
  el.className = `badge ${online ? 'badge-online' : 'badge-offline'}`;
}

// ─── Data Processing ──────────────────────────────────────────────────────────
function processReading(reading) {
  const { deviceId } = reading;

  // Register device
  if (!devices[deviceId]) {
    devices[deviceId] = { id: deviceId, readings: [] };
    renderDeviceTabs();
    if (!selectedDevice) selectDevice(deviceId);
  }

  devices[deviceId].latest = reading;
  devices[deviceId].readings.push(reading);
  if (devices[deviceId].readings.length > 100) devices[deviceId].readings.shift();

  if (selectedDevice === deviceId) {
    updateCards(reading);
    updateCharts(reading);
  }

  document.getElementById('last-update').textContent =
    'Updated: ' + new Date(reading.timestamp).toLocaleTimeString();
}

// ─── Cards ────────────────────────────────────────────────────────────────────
function updateCards(reading) {
  const sensors = [
    { key: 'soilMoisture', max: 100 },
    { key: 'temperature', max: 50 },
    { key: 'humidity', max: 100 },
  ];

  sensors.forEach(({ key, max }) => {
    const val = reading[key];
    if (val === undefined) return;

    document.getElementById(`val-${key}`).textContent = val;
    const pct = Math.min(100, (val / max) * 100);
    document.getElementById(`bar-${key}`).style.width = pct + '%';

    const { state, label } = getSensorState(key, val);
    const card = document.getElementById(`card-${key}`);
    card.className = `card ${state !== 'ok' ? state : ''}`;
    const statusEl = document.getElementById(`status-${key}`);
    statusEl.textContent = label;
    statusEl.className = `card-status status-${state}`;
  });
}

function getSensorState(key, val) {
  const t = THRESHOLDS[key];
  if (!t) return { state: 'ok', label: 'Normal' };

  if (key === 'soilMoisture') {
    if (val < t.low) return { state: 'warning', label: 'Dry' };
    if (val > t.high) return { state: 'info', label: 'Wet' };
  }
  if (key === 'temperature') {
    if (val > t.high) return { state: 'danger', label: 'Hot' };
  }
  if (key === 'humidity') {
    if (val < t.low) return { state: 'warning', label: 'Low' };
    if (val > t.high) return { state: 'warning', label: 'High' };
  }
  if (key === 'light') {
    if (val < t.low) return { state: 'info', label: 'Low' };
  }
  return { state: 'ok', label: 'Normal' };}

// ─── Device Tabs ──────────────────────────────────────────────────────────────
function renderDeviceTabs() {
  const container = document.getElementById('device-tabs');
  container.innerHTML = '';
  Object.keys(devices).forEach(id => {
    const btn = document.createElement('button');
    btn.className = `device-tab ${id === selectedDevice ? 'active' : ''}`;
    btn.textContent = id;
    btn.onclick = () => selectDevice(id);
    container.appendChild(btn);
  });
}

function selectDevice(id) {
  selectedDevice = id;
  renderDeviceTabs();
  const device = devices[id];
  if (device?.latest) {
    updateCards(device.latest);
    // Rebuild chart history from stored readings
    rebuildChartHistory(device.readings);
  }
}

function updateDeviceStatus(deviceId, data) {
  if (!devices[deviceId]) {
    devices[deviceId] = { id: deviceId, readings: [] };
    renderDeviceTabs();
  }
  devices[deviceId].status = data.status;
}

// ─── Charts ───────────────────────────────────────────────────────────────────
function initCharts() {
  const commonOptions = {
    responsive: true,
    animation: { duration: 300 },
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { maxTicksLimit: 8, font: { size: 10 } } },
      y: { ticks: { font: { size: 10 } } },
    },
  };

  charts.moisture = new Chart(document.getElementById('chart-moisture'), {
    type: 'line',
    data: { labels: [], datasets: [{ label: 'Soil Moisture %', data: [], borderColor: '#1976d2', backgroundColor: 'rgba(25,118,210,0.1)', fill: true, tension: 0.4, pointRadius: 2 }] },
    options: { ...commonOptions, plugins: { legend: { display: true } } },
  });

  charts.tempHumidity = new Chart(document.getElementById('chart-temp-humidity'), {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        { label: 'Temp °C', data: [], borderColor: '#e53935', backgroundColor: 'rgba(229,57,53,0.1)', fill: false, tension: 0.4, pointRadius: 2 },
        { label: 'Humidity %', data: [], borderColor: '#00897b', backgroundColor: 'rgba(0,137,123,0.1)', fill: false, tension: 0.4, pointRadius: 2 },
      ],
    },
    options: { ...commonOptions, plugins: { legend: { display: true } } },
  });

  charts.radar = new Chart(document.getElementById('chart-radar'), {
    type: 'radar',
    data: {
      labels: ['Soil Moisture', 'Temperature', 'Humidity'],
      datasets: [{ label: 'Current', data: [0, 0, 0], borderColor: '#2d7a3a', backgroundColor: 'rgba(45,122,58,0.2)', pointBackgroundColor: '#2d7a3a' }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { r: { min: 0, max: 100, ticks: { font: { size: 9 } } } },
    },
  });
}

const MAX_CHART_POINTS = 30;

function updateCharts(reading) {
  const time = new Date(reading.timestamp).toLocaleTimeString();

  // Moisture chart
  pushChartData(charts.moisture, time, reading.soilMoisture);

  // Temp + Humidity
  const th = charts.tempHumidity;
  if (th.data.labels.length >= MAX_CHART_POINTS) {
    th.data.labels.shift();
    th.data.datasets[0].data.shift();
    th.data.datasets[1].data.shift();
  }
  th.data.labels.push(time);
  th.data.datasets[0].data.push(reading.temperature);
  th.data.datasets[1].data.push(reading.humidity);
  th.update('none');

  // Radar — normalize to 0-100
  charts.radar.data.datasets[0].data = [
    reading.soilMoisture,
    Math.min(100, (reading.temperature / 50) * 100),
    reading.humidity,
  ];
  charts.radar.update('none');
}

function pushChartData(chart, label, value) {
  if (chart.data.labels.length >= MAX_CHART_POINTS) {
    chart.data.labels.shift();
    chart.data.datasets[0].data.shift();
  }
  chart.data.labels.push(label);
  chart.data.datasets[0].data.push(value);
  chart.update('none');
}

function rebuildChartHistory(readings) {
  // Clear charts
  [charts.moisture].forEach(c => {
    c.data.labels = []; c.data.datasets[0].data = []; c.update('none');
  });
  charts.tempHumidity.data.labels = [];
  charts.tempHumidity.data.datasets.forEach(d => d.data = []);
  charts.tempHumidity.update('none');

  const slice = readings.slice(-MAX_CHART_POINTS);
  slice.forEach(r => updateCharts(r));
}

// ─── Alerts ───────────────────────────────────────────────────────────────────
const ALERT_ICONS = { warning: '⚠️', danger: '🚨', info: 'ℹ️' };

function addAlertToUI(alert) {
  const list = document.getElementById('alerts-list');
  const noAlerts = list.querySelector('.no-alerts');
  if (noAlerts) noAlerts.remove();

  const item = document.createElement('div');
  item.className = `alert-item alert-${alert.type}`;
  item.innerHTML = `
    <span class="alert-icon">${ALERT_ICONS[alert.type] || '📢'}</span>
    <span class="alert-msg">${alert.message}</span>
    <span class="alert-time">${new Date(alert.timestamp).toLocaleTimeString()}</span>
  `;
  list.prepend(item);

  // Keep max 20 alerts in UI
  const items = list.querySelectorAll('.alert-item');
  if (items.length > 20) items[items.length - 1].remove();
}

function clearAlerts() {
  const list = document.getElementById('alerts-list');
  list.innerHTML = '<p class="no-alerts">No alerts yet.</p>';
}

// ─── Load initial data from REST API ─────────────────────────────────────────
async function loadInitialData() {
  try {
    const [readings, alerts] = await Promise.all([
      fetch(`${API_URL}/readings`).then(r => r.json()),
      fetch(`${API_URL}/alerts`).then(r => r.json()),
    ]);
    readings.forEach(r => processReading(r));
    alerts.slice(0, 20).reverse().forEach(a => addAlertToUI(a));
  } catch (e) {
    console.warn('Could not load initial data from API:', e.message);
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────
initCharts();
connectWS();
loadInitialData();

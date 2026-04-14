const WS_URL = 'wss://smart-agriculture-system-xiwn.onrender.com';
const API_URL = 'https://smart-agriculture-system-xiwn.onrender.com/api';

// ─── India Time Helper ────────────────────────────────────────────────────────
function toIST(timestamp) {
  const d = new Date(timestamp);
  // Ignore invalid/epoch timestamps (ESP32 millis bug)
  if (d.getFullYear() < 2020) return 'N/A';
  return d.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });
}

function toISTTime(timestamp) {
  const d = new Date(timestamp);
  if (d.getFullYear() < 2020) return 'N/A';
  return d.toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });
}

// ─── Password Gate ────────────────────────────────────────────────────────────
const DASHBOARD_PASSWORD = 'bhavi@123';

function checkPassword() {
  const input = document.getElementById('password-input').value;
  if (input === DASHBOARD_PASSWORD) {
    sessionStorage.setItem('agri_auth', 'true');
    document.getElementById('password-gate').style.display = 'none';
    document.getElementById('main-app').style.display = 'block';
    initDashboard();
  } else {
    const err = document.getElementById('gate-error');
    err.textContent = 'Incorrect password. Try again.';
    document.getElementById('password-input').value = '';
    document.getElementById('password-input').focus();
    setTimeout(() => err.textContent = '', 3000);
  }
}

// Auto-unlock if already authenticated this session
if (sessionStorage.getItem('agri_auth') === 'true') {
  document.getElementById('password-gate').style.display = 'none';
  document.getElementById('main-app').style.display = 'block';
}

// State
let selectedDevice = null;
let devices = {};
let historyData = { soilMoisture: [], temperature: [], humidity: [], light: [] };
let charts = {};
let ws;
let deviceTimeouts = {};           // per-device offline timer
const DEVICE_TIMEOUT_MS = 30000;   // 30s no data = device offline

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

  ws.onopen = () => {
    const el = document.getElementById('connection-status');
    el.textContent = '● Waiting for Device...';
    el.className = 'badge badge-offline';
  };
  ws.onclose = () => {
    const el = document.getElementById('connection-status');
    el.textContent = '● Server Disconnected';
    el.className = 'badge badge-offline';
    setTimeout(connectWS, 3000);
  };
  ws.onerror = () => {
    const el = document.getElementById('connection-status');
    el.textContent = '● Server Disconnected';
    el.className = 'badge badge-offline';
  };

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

// ─── Device Online/Offline Tracking ──────────────────────────────────────────
function markDeviceOnline(deviceId) {
  // Clear existing timeout
  if (deviceTimeouts[deviceId]) clearTimeout(deviceTimeouts[deviceId]);

  // Update device status
  if (devices[deviceId]) devices[deviceId].online = true;
  updateDeviceBadge(deviceId, true);

  // Set timeout — if no data in 30s, mark offline
  deviceTimeouts[deviceId] = setTimeout(() => {
    if (devices[deviceId]) devices[deviceId].online = false;
    updateDeviceBadge(deviceId, false);
    // Update header if this is selected device
    if (deviceId === selectedDevice) {
      const el = document.getElementById('connection-status');
      el.textContent = '● Device Offline';
      el.className = 'badge badge-offline';
    }
  }, DEVICE_TIMEOUT_MS);

  // Update header badge for selected device
  if (deviceId === selectedDevice) {
    const el = document.getElementById('connection-status');
    el.textContent = '● ESP32 Online';
    el.className = 'badge badge-online';
  }
}

function updateDeviceBadge(deviceId, online) {
  const tabs = document.querySelectorAll('.device-tab');
  tabs.forEach(tab => {
    if (tab.textContent.replace(/[🟢🔴]/g, '').trim() === deviceId) {
      tab.textContent = (online ? '🟢 ' : '🔴 ') + deviceId;
    }
  });
}

// ─── Data Processing ──────────────────────────────────────────────────────────
function processReading(reading, silent = false) {
  const { deviceId } = reading;

  // Skip readings with invalid timestamps (ESP32 millis bug)
  if (new Date(reading.timestamp).getFullYear() < 2020) return;

  // Register device
  if (!devices[deviceId]) {
    devices[deviceId] = { id: deviceId, readings: [], online: false };
    renderDeviceTabs();
    if (!selectedDevice) selectDevice(deviceId);
  }

  devices[deviceId].latest = reading;
  devices[deviceId].readings.push(reading);
  if (devices[deviceId].readings.length > 500) devices[deviceId].readings.shift();

  if (!silent) markDeviceOnline(deviceId);

  if (selectedDevice === deviceId && !silent) {
    updateCards(reading);
    updateCharts(reading);
  }

  if (!silent) {
    document.getElementById('last-update').textContent =
      'Updated: ' + toIST(reading.timestamp);
  }
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
  const time = toISTTime(reading.timestamp);

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
    <span class="alert-time">${toIST(alert.timestamp)}</span>
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
    const [readings, allHistory, alerts] = await Promise.all([
      fetch(`${API_URL}/readings`).then(r => r.json()),
      fetch(`${API_URL}/history/all?limit=500`).then(r => r.json()),
      fetch(`${API_URL}/alerts`).then(r => r.json()),
    ]);

    // Load history first (silent — just builds device list and stores readings)
    allHistory.forEach(r => processReading(r, true));

    // Then update cards with latest
    readings.forEach(r => processReading(r));

    // Rebuild charts from stored history for selected device
    if (selectedDevice && devices[selectedDevice]) {
      rebuildChartHistory(devices[selectedDevice].readings);
      updateCards(devices[selectedDevice].latest);
    }

    alerts.slice(0, 20).reverse().forEach(a => addAlertToUI(a));
  } catch (e) {
    console.warn('Could not load initial data from API:', e.message);
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────
function initDashboard() {
  initCharts();
  connectWS();
  loadInitialData();

  // Start with "waiting for device" status, update once data arrives
  setTimeout(() => {
    Object.keys(devices).forEach(deviceId => {
      if (!devices[deviceId].online) {
        updateDeviceBadge(deviceId, false);
        if (deviceId === selectedDevice) {
          const el = document.getElementById('connection-status');
          el.textContent = '● Device Offline';
          el.className = 'badge badge-offline';
        }
      }
    });
    // If no devices at all yet
    if (Object.keys(devices).length === 0) {
      const el = document.getElementById('connection-status');
      el.textContent = '● No Device';
      el.className = 'badge badge-offline';
    }
  }, DEVICE_TIMEOUT_MS);
}

// Auto-start if already authenticated
if (sessionStorage.getItem('agri_auth') === 'true') {
  initDashboard();
}

// ─── PDF Report ───────────────────────────────────────────────────────────────
async function downloadPDFReport() {
  const btn = document.querySelector('.btn-pdf');
  btn.textContent = '⏳ Generating...';
  btn.disabled = true;

  try {
    const res = await fetch(`${API_URL}/history/all?limit=720`);
    const allData = await res.json();

    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    // Filter valid timestamps AND last 1 hour only
    const data = allData.filter(r => {
      const ts = new Date(r.timestamp).getTime();
      return ts > oneHourAgo && new Date(r.timestamp).getFullYear() >= 2020;
    });

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageW = 210;
    const margin = 15;
    let y = 20;

    // ── Header ──
    doc.setFillColor(45, 122, 58);
    doc.rect(0, 0, pageW, 30, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text('Smart Agriculture Monitor', margin, 13);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text('1-Hour Sensor Report', margin, 21);
    const now = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    doc.text(`Generated: ${now} IST`, pageW - margin, 21, { align: 'right' });

    y = 40;
    doc.setTextColor(30, 30, 30);

    if (data.length === 0) {
      doc.setFontSize(12);
      doc.text('No data available for the last 1 hour.', margin, y);
      doc.save('agri-report.pdf');
      return;
    }

    // ── Summary Stats ──
    const moisture = data.map(r => r.soilMoisture).filter(v => v != null);
    const temp     = data.map(r => r.temperature).filter(v => v != null);
    const humidity = data.map(r => r.humidity).filter(v => v != null);

    // Derive irrigation from moisture threshold (< 30% = ON)
    const irrigationON = moisture.filter(v => v < 30).length;
    const irrigationPct = moisture.length ? Math.round((irrigationON / moisture.length) * 100) : 0;

    function stats(arr) {
      if (!arr.length) return { min: 'N/A', max: 'N/A', avg: 'N/A' };
      return {
        min: Math.min(...arr).toFixed(1),
        max: Math.max(...arr).toFixed(1),
        avg: (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1),
      };
    }

    const mStats = stats(moisture);
    const tStats = stats(temp);
    const hStats = stats(humidity);

    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.text('Summary Statistics', margin, y);
    y += 7;

    doc.setFillColor(232, 245, 233);
    doc.rect(margin, y, pageW - margin * 2, 8, 'F');
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('Sensor', margin + 3, y + 5.5);
    doc.text('Min', 80, y + 5.5);
    doc.text('Max', 110, y + 5.5);
    doc.text('Average', 140, y + 5.5);
    doc.text('Readings', 170, y + 5.5);
    y += 8;

    const rows = [
      ['Soil Moisture (%)', mStats.min, mStats.max, mStats.avg, moisture.length],
      ['Temperature (°C)',  tStats.min, tStats.max, tStats.avg, temp.length],
      ['Humidity (%)',      hStats.min, hStats.max, hStats.avg, humidity.length],
    ];

    doc.setFont('helvetica', 'normal');
    rows.forEach((row, i) => {
      if (i % 2 === 0) { doc.setFillColor(248, 252, 248); doc.rect(margin, y, pageW - margin * 2, 8, 'F'); }
      doc.text(String(row[0]), margin + 3, y + 5.5);
      doc.text(String(row[1]), 80, y + 5.5);
      doc.text(String(row[2]), 110, y + 5.5);
      doc.text(String(row[3]), 140, y + 5.5);
      doc.text(String(row[4]), 170, y + 5.5);
      y += 8;
    });

    y += 6;

    // ── Irrigation Summary ──
    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.text('Irrigation Activity', margin, y);
    y += 7;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    const irrStatus = irrigationPct > 50 ? 'HIGH — Soil was mostly dry' : irrigationPct > 0 ? 'MODERATE' : 'LOW — Soil moisture was adequate';
    doc.text(`Readings with low moisture (< 30%): ${irrigationON} of ${moisture.length} (${irrigationPct}%)`, margin + 3, y);
    y += 6;
    doc.text(`Irrigation need: ${irrStatus}`, margin + 3, y);
    y += 12;

    // ── Charts from canvas ──
    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.text('Sensor Charts', margin, y);
    y += 5;

    // Capture existing charts from dashboard canvas
    const chartIds = [
      { id: 'chart-moisture',     label: 'Soil Moisture Over Time' },
      { id: 'chart-temp-humidity', label: 'Temperature & Humidity' },
    ];

    for (const ch of chartIds) {
      const canvas = document.getElementById(ch.id);
      if (!canvas) continue;
      const imgData = canvas.toDataURL('image/png');
      const imgW = pageW - margin * 2;
      const imgH = 55;
      if (y + imgH + 10 > 285) { doc.addPage(); y = 15; }
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.text(ch.label, margin, y + 5);
      y += 7;
      doc.addImage(imgData, 'PNG', margin, y, imgW, imgH);
      y += imgH + 8;
    }

    // ── Readings Table ──
    doc.addPage();
    y = 20;
    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30, 30, 30);
    doc.text('Sensor Readings Log', margin, y);
    y += 7;

    doc.setFillColor(45, 122, 58);
    doc.rect(margin, y, pageW - margin * 2, 8, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text('Time (IST)',   margin + 2, y + 5.5);
    doc.text('Moisture %',  70,  y + 5.5);
    doc.text('Temp °C',     105, y + 5.5);
    doc.text('Humidity %',  135, y + 5.5);
    doc.text('Irrigation',  168, y + 5.5);
    y += 8;

    doc.setTextColor(30, 30, 30);
    doc.setFont('helvetica', 'normal');

    data.forEach((r, i) => {
      if (y > 275) { doc.addPage(); y = 20; }
      if (i % 2 === 0) { doc.setFillColor(248, 252, 248); doc.rect(margin, y, pageW - margin * 2, 7, 'F'); }
      // Derive irrigation from moisture
      const isIrrigating = r.soilMoisture != null && r.soilMoisture < 30;
      doc.text(toISTTime(r.timestamp),                                    margin + 2, y + 5);
      doc.text(r.soilMoisture != null ? String(r.soilMoisture) : '-',    70,  y + 5);
      doc.text(r.temperature  != null ? String(r.temperature)  : '-',    105, y + 5);
      doc.text(r.humidity     != null ? String(r.humidity)     : '-',    135, y + 5);
      // Color irrigation status
      if (isIrrigating) {
        doc.setTextColor(25, 118, 210);
        doc.text('ON', 168, y + 5);
        doc.setTextColor(30, 30, 30);
      } else {
        doc.text('OFF', 168, y + 5);
      }
      y += 7;
    });

    // ── Footer ──
    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(150, 150, 150);
      doc.text(`Smart Agriculture IoT Monitoring System — Page ${i} of ${pageCount}`, pageW / 2, 290, { align: 'center' });
    }

    const filename = `agri-report-${new Date().toISOString().slice(0,10)}.pdf`;
    doc.save(filename);

  } catch (e) {
    console.error(e);
    alert('Failed to generate report: ' + e.message);
  } finally {
    btn.textContent = '⬇ 1-Hour Report';
    btn.disabled = false;
  }
}

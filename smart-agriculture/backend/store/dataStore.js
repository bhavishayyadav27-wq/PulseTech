const path = require('path');
const fs = require('fs');

// Ensure data directory exists
const DB_DIR = path.join(__dirname, '../data');
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const DB_PATH = path.join(DB_DIR, 'agri.db');

// Load sql.js (pure JS, no native compilation needed)
const initSqlJs = require('sql.js');

let db;
let saveTimer;

async function initDB() {
  const SQL = await initSqlJs();

  // Load existing DB file if it exists
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS readings (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      deviceId     TEXT NOT NULL,
      soilMoisture REAL,
      temperature  REAL,
      humidity     REAL,
      irrigation   INTEGER DEFAULT 0,
      timestamp    TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS alerts (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      deviceId  TEXT NOT NULL,
      type      TEXT NOT NULL,
      sensor    TEXT NOT NULL,
      message   TEXT NOT NULL,
      timestamp TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_readings_time ON readings(timestamp);
  `);

  persistDB();
  console.log('Database initialized');
}

// Persist DB to disk (sql.js is in-memory, we save periodically)
function persistDB() {
  if (!db) return;
  try {
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  } catch (e) {
    console.error('DB persist error:', e.message);
  }
}

// Auto-save every 10 seconds
setInterval(persistDB, 10000);

// ─── Write ────────────────────────────────────────────────────────────────────
function saveReading(reading) {
  if (!db) return;
  db.run(
    `INSERT INTO readings (deviceId, soilMoisture, temperature, humidity, irrigation, timestamp)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      reading.deviceId,
      reading.soilMoisture ?? null,
      reading.temperature  ?? null,
      reading.humidity     ?? null,
      reading.irrigation ? 1 : 0,
      reading.timestamp || new Date().toISOString(),
    ]
  );
}

function addAlert(alert) {
  if (!db) return;
  db.run(
    `INSERT INTO alerts (deviceId, type, sensor, message, timestamp) VALUES (?, ?, ?, ?, ?)`,
    [alert.deviceId, alert.type, alert.sensor, alert.message, alert.timestamp || new Date().toISOString()]
  );
}

// ─── Read helpers ─────────────────────────────────────────────────────────────
function queryAll(sql, params = []) {
  if (!db) return [];
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

// ─── Read ─────────────────────────────────────────────────────────────────────
function getLatestReadings() {
  return queryAll(`
    SELECT r.* FROM readings r
    INNER JOIN (
      SELECT deviceId, MAX(timestamp) as maxTs FROM readings GROUP BY deviceId
    ) latest ON r.deviceId = latest.deviceId AND r.timestamp = latest.maxTs
  `);
}

function getHistory(sensor, limit = 100, deviceId = null) {
  let rows;
  if (deviceId) {
    rows = queryAll(`SELECT * FROM readings WHERE deviceId = ? ORDER BY timestamp DESC LIMIT ?`, [deviceId, limit]);
  } else {
    rows = queryAll(`SELECT * FROM readings ORDER BY timestamp DESC LIMIT ?`, [limit]);
  }
  rows = rows.reverse();
  if (sensor) {
    return rows.map(r => ({ deviceId: r.deviceId, timestamp: r.timestamp, value: r[sensor] }))
               .filter(r => r.value !== null);
  }
  return rows;
}

function getAllHistory(limit = 500) {
  return queryAll(`SELECT * FROM readings ORDER BY timestamp DESC LIMIT ?`, [limit]).reverse();
}

function getAlerts(limit = 100) {
  return queryAll(`SELECT * FROM alerts ORDER BY timestamp DESC LIMIT ?`, [limit]);
}

function getStats() {
  const total   = queryAll(`SELECT COUNT(*) as count FROM readings`)[0] || { count: 0 };
  const devices = queryAll(`SELECT COUNT(DISTINCT deviceId) as count FROM readings`)[0] || { count: 0 };
  const oldest  = queryAll(`SELECT MIN(timestamp) as ts FROM readings`)[0] || { ts: null };
  return { totalReadings: total.count, totalDevices: devices.count, since: oldest.ts };
}

module.exports = { initDB, saveReading, addAlert, getLatestReadings, getHistory, getAllHistory, getAlerts, getStats, persistDB };

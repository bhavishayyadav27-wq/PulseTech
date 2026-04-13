const Database = require('better-sqlite3');
const path = require('path');

// Database file stored in backend/data/agri.db
const DB_PATH = path.join(__dirname, '../data/agri.db');
const db = new Database(DB_PATH);

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS readings (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    deviceId  TEXT NOT NULL,
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

  CREATE INDEX IF NOT EXISTS idx_readings_device ON readings(deviceId);
  CREATE INDEX IF NOT EXISTS idx_readings_time   ON readings(timestamp);
`);

// Prepared statements
const insertReading = db.prepare(`
  INSERT INTO readings (deviceId, soilMoisture, temperature, humidity, irrigation, timestamp)
  VALUES (@deviceId, @soilMoisture, @temperature, @humidity, @irrigation, @timestamp)
`);

const insertAlert = db.prepare(`
  INSERT INTO alerts (deviceId, type, sensor, message, timestamp)
  VALUES (@deviceId, @type, @sensor, @message, @timestamp)
`);

// ─── Write ────────────────────────────────────────────────────────────────────
function saveReading(reading) {
  insertReading.run({
    deviceId:     reading.deviceId,
    soilMoisture: reading.soilMoisture ?? null,
    temperature:  reading.temperature  ?? null,
    humidity:     reading.humidity     ?? null,
    irrigation:   reading.irrigation ? 1 : 0,
    timestamp:    reading.timestamp || new Date().toISOString(),
  });
}

function addAlert(alert) {
  insertAlert.run({
    deviceId:  alert.deviceId,
    type:      alert.type,
    sensor:    alert.sensor,
    message:   alert.message,
    timestamp: alert.timestamp || new Date().toISOString(),
  });
}

// ─── Read ─────────────────────────────────────────────────────────────────────

// Latest reading per device
function getLatestReadings() {
  return db.prepare(`
    SELECT r.*
    FROM readings r
    INNER JOIN (
      SELECT deviceId, MAX(timestamp) as maxTs
      FROM readings GROUP BY deviceId
    ) latest ON r.deviceId = latest.deviceId AND r.timestamp = latest.maxTs
  `).all();
}

// History — optionally filter by sensor and device
function getHistory(sensor, limit = 100, deviceId = null) {
  let query = `SELECT * FROM readings`;
  const params = [];

  if (deviceId) {
    query += ` WHERE deviceId = ?`;
    params.push(deviceId);
  }

  query += ` ORDER BY timestamp DESC LIMIT ?`;
  params.push(limit);

  const rows = db.prepare(query).all(...params).reverse();

  if (sensor) {
    return rows.map(r => ({
      deviceId:  r.deviceId,
      timestamp: r.timestamp,
      value:     r[sensor],
    })).filter(r => r.value !== null);
  }

  return rows;
}

// All history for charts (last N per device)
function getAllHistory(limit = 500) {
  return db.prepare(`
    SELECT * FROM readings ORDER BY timestamp DESC LIMIT ?
  `).all(limit).reverse();
}

function getAlerts(limit = 100) {
  return db.prepare(`
    SELECT * FROM alerts ORDER BY timestamp DESC LIMIT ?
  `).all(limit);
}

function getStats() {
  const total   = db.prepare(`SELECT COUNT(*) as count FROM readings`).get();
  const devices = db.prepare(`SELECT COUNT(DISTINCT deviceId) as count FROM readings`).get();
  const oldest  = db.prepare(`SELECT MIN(timestamp) as ts FROM readings`).get();
  return {
    totalReadings: total.count,
    totalDevices:  devices.count,
    since:         oldest.ts,
  };
}

module.exports = { saveReading, addAlert, getLatestReadings, getHistory, getAllHistory, getAlerts, getStats };

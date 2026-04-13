// In-memory data store (replace with a database like InfluxDB/MongoDB in production)

const MAX_HISTORY = 500;
const MAX_ALERTS = 100;

const latestReadings = {}; // deviceId -> latest reading
const history = [];        // all readings (time-series)
const alerts = [];         // alert log

function saveReading(reading) {
  latestReadings[reading.deviceId] = reading;
  history.push(reading);
  if (history.length > MAX_HISTORY) history.shift();
}

function getLatestReadings() {
  return Object.values(latestReadings);
}

function getHistory(sensor, limit = 50) {
  let data = [...history];
  if (sensor) {
    data = data.map(r => ({
      deviceId: r.deviceId,
      timestamp: r.timestamp,
      value: r[sensor],
    })).filter(r => r.value !== undefined);
  }
  return data.slice(-limit);
}

function addAlert(alert) {
  alerts.unshift(alert); // newest first
  if (alerts.length > MAX_ALERTS) alerts.pop();
}

function getAlerts() {
  return alerts;
}

module.exports = { saveReading, getLatestReadings, getHistory, addAlert, getAlerts };

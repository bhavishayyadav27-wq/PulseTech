const mqtt = require('mqtt');
const { saveReading, addAlert } = require('../store/dataStore');

const BROKER = process.env.MQTT_BROKER || 'mqtt://broker.hivemq.com';
const TOPIC_PREFIX = process.env.MQTT_TOPIC_PREFIX || 'smart-agri';

const THRESHOLDS = {
  soilMoisture: {
    low:  parseFloat(process.env.SOIL_MOISTURE_LOW)  || 30,
    high: parseFloat(process.env.SOIL_MOISTURE_HIGH) || 80,
  },
  temperature: { high: parseFloat(process.env.TEMPERATURE_HIGH) || 35 },
  humidity: {
    low:  parseFloat(process.env.HUMIDITY_LOW)  || 40,
    high: parseFloat(process.env.HUMIDITY_HIGH) || 90,
  },
};

// Track last seen time per device on the backend
const deviceLastSeen = {};
const DEVICE_TIMEOUT_MS = 10000; // 10 seconds — 2 missed readings
const deviceTimers = {};

let client;

function connect() {
  console.log(`Connecting to MQTT broker: ${BROKER}`);
  client = mqtt.connect(BROKER, {
    clientId: `smart-agri-server-${Date.now()}`,
    clean: true,
    reconnectPeriod: 5000,
    // Last Will Testament — broker auto-publishes this if server disconnects
    will: {
      topic: `${TOPIC_PREFIX}/server/status`,
      payload: JSON.stringify({ status: 'offline' }),
      qos: 1,
      retain: false,
    },
  });

  client.on('connect', () => {
    console.log('MQTT connected');
    client.subscribe(`${TOPIC_PREFIX}/+/sensors`, { qos: 1 });
    client.subscribe(`${TOPIC_PREFIX}/+/status`, { qos: 0 });
  });

  client.on('message', (topic, message) => {
    try {
      const parts = topic.split('/');
      const deviceId = parts[1];
      const msgType = parts[2];
      const payload = JSON.parse(message.toString());

      if (msgType === 'sensors') {
        handleSensorData(deviceId, payload);
      } else if (msgType === 'status') {
        handleDeviceStatus(deviceId, payload);
      }
    } catch (err) {
      console.error('Error parsing MQTT message:', err.message);
    }
  });

  client.on('error', (err) => console.error('MQTT error:', err.message));
  client.on('reconnect', () => console.log('MQTT reconnecting...'));
}

function markDeviceOnline(deviceId) {
  const wasOffline = !deviceLastSeen[deviceId] ||
    (Date.now() - deviceLastSeen[deviceId] > DEVICE_TIMEOUT_MS);

  deviceLastSeen[deviceId] = Date.now();

  // Clear existing offline timer
  if (deviceTimers[deviceId]) clearTimeout(deviceTimers[deviceId]);

  // If device was offline, broadcast it coming online
  if (wasOffline) {
    console.log(`Device ${deviceId} is ONLINE`);
    if (global.broadcast) {
      global.broadcast({ type: 'deviceOnline', deviceId, timestamp: new Date().toISOString() });
    }
  }

  // Set timer — if no data in 20s, broadcast offline
  deviceTimers[deviceId] = setTimeout(() => {
    console.log(`Device ${deviceId} is OFFLINE (timeout)`);
    if (global.broadcast) {
      global.broadcast({ type: 'deviceOffline', deviceId, timestamp: new Date().toISOString() });
    }
  }, DEVICE_TIMEOUT_MS);
}

function handleSensorData(deviceId, payload) {
  const reading = {
    deviceId,
    timestamp: new Date().toISOString(),
    soilMoisture: payload.soilMoisture,
    temperature:  payload.temperature,
    humidity:     payload.humidity,
  };

  markDeviceOnline(deviceId);
  saveReading(reading);
  checkThresholds(reading);

  if (global.broadcast) {
    global.broadcast({ type: 'sensorUpdate', data: reading });
  }
}

function handleDeviceStatus(deviceId, payload) {
  if (payload.status === 'offline') {
    // ESP32 sent explicit offline message
    if (deviceTimers[deviceId]) clearTimeout(deviceTimers[deviceId]);
    delete deviceLastSeen[deviceId];
    console.log(`Device ${deviceId} sent OFFLINE status`);
    if (global.broadcast) {
      global.broadcast({ type: 'deviceOffline', deviceId, timestamp: new Date().toISOString() });
    }
  } else if (payload.status === 'online') {
    markDeviceOnline(deviceId);
    if (global.broadcast) {
      global.broadcast({ type: 'deviceOnline', deviceId, timestamp: new Date().toISOString() });
    }
  }
}

function checkThresholds(reading) {
  const alerts = [];
  const { deviceId, soilMoisture, temperature, humidity } = reading;

  if (soilMoisture !== undefined) {
    if (soilMoisture < THRESHOLDS.soilMoisture.low)
      alerts.push({ type: 'warning', sensor: 'soilMoisture', message: `Low soil moisture (${soilMoisture}%) on ${deviceId}. Irrigation recommended.` });
    else if (soilMoisture > THRESHOLDS.soilMoisture.high)
      alerts.push({ type: 'info', sensor: 'soilMoisture', message: `High soil moisture (${soilMoisture}%) on ${deviceId}.` });
  }
  if (temperature !== undefined && temperature > THRESHOLDS.temperature.high)
    alerts.push({ type: 'danger', sensor: 'temperature', message: `High temperature (${temperature}°C) on ${deviceId}. Risk of heat stress.` });
  if (humidity !== undefined) {
    if (humidity < THRESHOLDS.humidity.low)
      alerts.push({ type: 'warning', sensor: 'humidity', message: `Low humidity (${humidity}%) on ${deviceId}.` });
    else if (humidity > THRESHOLDS.humidity.high)
      alerts.push({ type: 'warning', sensor: 'humidity', message: `High humidity (${humidity}%) on ${deviceId}. Disease risk.` });
  }

  alerts.forEach(alert => {
    const fullAlert = { ...alert, deviceId, timestamp: reading.timestamp };
    addAlert(fullAlert);
    if (global.broadcast) global.broadcast({ type: 'alert', data: fullAlert });
  });
}

function sendIrrigationCommand(deviceId, state) {
  if (!client) return;
  const topic = `${TOPIC_PREFIX}/${deviceId}/commands`;
  client.publish(topic, JSON.stringify({ command: 'irrigation', state, timestamp: new Date().toISOString() }), { qos: 1 });
}

module.exports = { connect, sendIrrigationCommand };

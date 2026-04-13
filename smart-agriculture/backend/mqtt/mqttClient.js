const mqtt = require('mqtt');
const { saveReading, addAlert } = require('../store/dataStore');

const BROKER = process.env.MQTT_BROKER || 'mqtt://broker.hivemq.com';
const TOPIC_PREFIX = process.env.MQTT_TOPIC_PREFIX || 'smart-agri';

// Thresholds from env
const THRESHOLDS = {
  soilMoisture: {
    low: parseFloat(process.env.SOIL_MOISTURE_LOW) || 30,
    high: parseFloat(process.env.SOIL_MOISTURE_HIGH) || 80,
  },
  temperature: { high: parseFloat(process.env.TEMPERATURE_HIGH) || 35 },
  humidity: {
    low: parseFloat(process.env.HUMIDITY_LOW) || 40,
    high: parseFloat(process.env.HUMIDITY_HIGH) || 90,
  },
  light: { low: parseFloat(process.env.LIGHT_LOW) || 200 },
};

let client;

function connect() {
  console.log(`Connecting to MQTT broker: ${BROKER}`);
  client = mqtt.connect(BROKER, {
    clientId: `smart-agri-server-${Date.now()}`,
    clean: true,
    reconnectPeriod: 5000,
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

function handleSensorData(deviceId, payload) {
  const reading = {
    deviceId,
    timestamp: new Date().toISOString(),  // always use server time (IST-aware)
    soilMoisture: payload.soilMoisture,
    temperature: payload.temperature,
    humidity: payload.humidity,
  };

  saveReading(reading);
  checkThresholds(reading);

  if (global.broadcast) {
    global.broadcast({ type: 'sensorUpdate', data: reading });
  }
}

function handleDeviceStatus(deviceId, payload) {
  if (global.broadcast) {
    global.broadcast({ type: 'deviceStatus', deviceId, data: payload });
  }
}

function checkThresholds(reading) {
  const alerts = [];
  const { deviceId, soilMoisture, temperature, humidity, light } = reading;

  if (soilMoisture !== undefined) {
    if (soilMoisture < THRESHOLDS.soilMoisture.low) {
      alerts.push({ type: 'warning', sensor: 'soilMoisture', message: `Low soil moisture (${soilMoisture}%) on device ${deviceId}. Irrigation recommended.` });
    } else if (soilMoisture > THRESHOLDS.soilMoisture.high) {
      alerts.push({ type: 'info', sensor: 'soilMoisture', message: `High soil moisture (${soilMoisture}%) on device ${deviceId}.` });
    }
  }

  if (temperature !== undefined && temperature > THRESHOLDS.temperature.high) {
    alerts.push({ type: 'danger', sensor: 'temperature', message: `High temperature (${temperature}°C) on device ${deviceId}. Risk of heat stress.` });
  }

  if (humidity !== undefined) {
    if (humidity < THRESHOLDS.humidity.low) {
      alerts.push({ type: 'warning', sensor: 'humidity', message: `Low humidity (${humidity}%) on device ${deviceId}.` });
    } else if (humidity > THRESHOLDS.humidity.high) {
      alerts.push({ type: 'warning', sensor: 'humidity', message: `High humidity (${humidity}%) on device ${deviceId}. Disease risk.` });
    }
  }

  if (light !== undefined && light < THRESHOLDS.light.low) {
    alerts.push({ type: 'info', sensor: 'light', message: `Low light level (${light} lux) on device ${deviceId}.` });
  }

  alerts.forEach(alert => {
    const fullAlert = { ...alert, deviceId, timestamp: reading.timestamp };
    addAlert(fullAlert);
    if (global.broadcast) {
      global.broadcast({ type: 'alert', data: fullAlert });
    }
  });
}

// Publish irrigation command to a device
function sendIrrigationCommand(deviceId, state) {
  if (!client) return;
  const topic = `${TOPIC_PREFIX}/${deviceId}/commands`;
  client.publish(topic, JSON.stringify({ command: 'irrigation', state, timestamp: new Date().toISOString() }), { qos: 1 });
}

module.exports = { connect, sendIrrigationCommand };

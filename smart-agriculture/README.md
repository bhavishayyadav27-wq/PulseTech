# 🌱 IoT Smart Agriculture Monitoring System

Real-time field monitoring using IoT sensors, MQTT, Node.js, and a live web dashboard.

## Architecture

```
[ESP32 Sensors] ──MQTT──► [HiveMQ Broker] ──MQTT──► [Node.js Backend]
                                                            │
                                                     [WebSocket]
                                                            │
                                                    [Web Dashboard]
```

## Project Structure

```
smart-agriculture/
├── backend/          # Node.js + Express REST API + WebSocket server
├── simulator/        # Python MQTT sensor simulator (no hardware needed)
├── dashboard/        # HTML/CSS/JS live dashboard
└── arduino/          # ESP32 firmware (.ino)
```

## Quick Start

### 1. Backend

```bash
cd backend
npm install
npm start
```

Server runs on http://localhost:3000

### 2. Sensor Simulator (no hardware needed)

```bash
cd simulator
pip install -r requirements.txt
python simulator.py
```

Simulates 3 field devices publishing data every 5 seconds.

### 3. Dashboard

Open `dashboard/index.html` in your browser.
It connects to the backend WebSocket at `ws://localhost:3000`.

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/readings` | Latest readings from all devices |
| GET | `/api/history?sensor=soilMoisture&limit=50` | Historical data |
| GET | `/api/alerts` | Recent alerts |
| GET | `/api/status` | Server health check |

## Sensor Thresholds (configurable in `.env`)

| Sensor | Alert Condition |
|--------|----------------|
| Soil Moisture | < 30% → Irrigation warning |
| Temperature | > 35°C → Heat stress danger |
| Humidity | < 40% or > 90% → Warning |
| Light | < 200 lux → Low light info |

## Hardware Setup (ESP32)

| Component | GPIO |
|-----------|------|
| DHT22 (Temp/Humidity) | GPIO 4 |
| Soil Moisture Sensor | GPIO 34 (ADC) |
| LDR (Light) | GPIO 35 (ADC) |

Edit `arduino/smart_agri_esp32/smart_agri_esp32.ino`:
- Set `WIFI_SSID` and `WIFI_PASSWORD`
- Set a unique `DEVICE_ID` per node
- Install libraries: PubSubClient, DHT, ArduinoJson

## Tech Stack

- **Firmware**: C++ (Arduino/ESP32)
- **Broker**: HiveMQ (public) / any MQTT broker
- **Backend**: Node.js, Express, MQTT.js, WebSocket
- **Simulator**: Python, paho-mqtt
- **Dashboard**: Vanilla JS, Chart.js

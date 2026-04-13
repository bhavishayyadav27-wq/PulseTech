"""
IoT Sensor Simulator
Simulates ESP32/Arduino devices publishing sensor data via MQTT.
Install: pip install paho-mqtt
Run: python simulator.py
"""

import paho.mqtt.client as mqtt
import json
import time
import random
import math
from datetime import datetime, timezone

BROKER = "broker.hivemq.com"
PORT = 1883
TOPIC_PREFIX = "smart-agri"
PUBLISH_INTERVAL = 5  # seconds

# Simulate multiple field devices
DEVICES = [
    {"id": "field-01", "zone": "North Field"},
    {"id": "field-02", "zone": "South Field"},
    {"id": "field-03", "zone": "Greenhouse"},
]

# Base values per device (simulate different field conditions)
BASE_VALUES = {
    "field-01": {"soilMoisture": 55, "temperature": 28, "humidity": 65, "light": 800},
    "field-02": {"soilMoisture": 40, "temperature": 30, "humidity": 58, "light": 950},
    "field-03": {"soilMoisture": 70, "temperature": 26, "humidity": 75, "light": 400},
}

tick = 0  # global time tick for drift simulation


def generate_sensor_data(device_id):
    """Generate realistic sensor readings with drift and noise."""
    global tick
    base = BASE_VALUES[device_id]

    # Simulate gradual soil moisture drop (irrigation cycle)
    moisture_drift = -0.05 * tick + random.uniform(-2, 2)
    soil_moisture = max(10, min(100, base["soilMoisture"] + moisture_drift))

    # Temperature follows a daily sine curve
    hour_angle = (tick * PUBLISH_INTERVAL / 3600) * (2 * math.pi / 24)
    temp_variation = 5 * math.sin(hour_angle) + random.uniform(-1, 1)
    temperature = round(base["temperature"] + temp_variation, 1)

    # Humidity inversely related to temperature
    humidity = round(base["humidity"] - temp_variation * 0.8 + random.uniform(-3, 3), 1)
    humidity = max(20, min(100, humidity))

    # Light varies with time of day
    light_variation = 300 * math.sin(hour_angle) + random.uniform(-50, 50)
    light = max(0, round(base["light"] + light_variation, 0))

    return {
        "deviceId": device_id,
        "soilMoisture": round(soil_moisture, 1),
        "temperature": temperature,
        "humidity": humidity,
        "light": int(light),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


def on_connect(client, userdata, flags, rc, properties=None):
    if rc == 0:
        print(f"[MQTT] Connected to {BROKER}")
        # Publish online status for each device
        for device in DEVICES:
            topic = f"{TOPIC_PREFIX}/{device['id']}/status"
            payload = json.dumps({"status": "online", "zone": device["zone"]})
            client.publish(topic, payload, qos=0)
    else:
        print(f"[MQTT] Connection failed with code {rc}")


def on_publish(client, userdata, mid, reason_code=None, properties=None):
    pass  # silent publish confirmation


def main():
    global tick

    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"agri-simulator-{int(time.time())}")
    client.on_connect = on_connect
    client.on_publish = on_publish

    print(f"[SIM] Connecting to MQTT broker: {BROKER}:{PORT}")
    client.connect(BROKER, PORT, keepalive=60)
    client.loop_start()

    time.sleep(2)  # wait for connection

    print(f"[SIM] Publishing sensor data every {PUBLISH_INTERVAL}s for {len(DEVICES)} devices...")
    print("[SIM] Press Ctrl+C to stop\n")

    try:
        while True:
            for device in DEVICES:
                data = generate_sensor_data(device["id"])
                topic = f"{TOPIC_PREFIX}/{device['id']}/sensors"
                payload = json.dumps(data)
                client.publish(topic, payload, qos=1)
                print(f"[{device['id']}] Moisture:{data['soilMoisture']}% | "
                      f"Temp:{data['temperature']}°C | "
                      f"Humidity:{data['humidity']}% | "
                      f"Light:{data['light']} lux")

            tick += 1
            print("---")
            time.sleep(PUBLISH_INTERVAL)

    except KeyboardInterrupt:
        print("\n[SIM] Stopping simulator...")
        for device in DEVICES:
            topic = f"{TOPIC_PREFIX}/{device['id']}/status"
            client.publish(topic, json.dumps({"status": "offline"}), qos=0)
        time.sleep(1)
        client.loop_stop()
        client.disconnect()


if __name__ == "__main__":
    main()

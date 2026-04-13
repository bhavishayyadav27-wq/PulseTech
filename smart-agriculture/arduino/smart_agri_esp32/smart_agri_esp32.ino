/**
 * Smart Agriculture IoT Node
 * Hardware: ESP32 + DHT11 + Soil Moisture Sensor + LDR + SG90 Servo
 *
 * Wiring:
 *   DHT11 DATA        -> GPIO 4
 *   Soil Moisture AO  -> GPIO 34 (ADC)
 *   LDR Module AO     -> GPIO 35 (ADC)
 *   Servo Signal      -> GPIO 18
 *   Servo VCC         -> VIN (5V)
 *   All GNDs          -> GND
 *
 * Libraries (install via Arduino Library Manager):
 *   - DHT sensor library by Adafruit
 *   - Adafruit Unified Sensor by Adafruit
 *   - PubSubClient by Nick O'Leary
 *   - ArduinoJson by Benoit Blanchon
 */

#include <WiFi.h>
#include <PubSubClient.h>
#include <DHT.h>
#include <ArduinoJson.h>
#include <ESP32Servo.h>

// ─── CHANGE THESE ─────────────────────────────────────────────────────────────
const char* WIFI_SSID     = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
const char* DEVICE_ID     = "field-01";
// ──────────────────────────────────────────────────────────────────────────────

const char* MQTT_BROKER  = "broker.hivemq.com";
const int   MQTT_PORT    = 1883;
const char* TOPIC_PREFIX = "smart-agri";

// ─── Pins ─────────────────────────────────────────────────────────────────────
#define DHT_PIN       4
#define DHT_TYPE      DHT11    // <-- DHT11 (not DHT22)
#define SOIL_PIN      34
#define LIGHT_PIN     35
#define SERVO_PIN     18

// ─── Soil Moisture Calibration ────────────────────────────────────────────────
// Run the serial monitor and note ADC values when probe is dry vs in water
#define SOIL_DRY   3500
#define SOIL_WET   1200

// ─── Irrigation Threshold ─────────────────────────────────────────────────────
#define MOISTURE_THRESHOLD_LOW  30   // % — auto-irrigate below this
#define MOISTURE_THRESHOLD_HIGH 60   // % — stop irrigation above this

// ─── Timing ───────────────────────────────────────────────────────────────────
#define PUBLISH_INTERVAL_MS  5000

// ─── Globals ──────────────────────────────────────────────────────────────────
WiFiClient   wifiClient;
PubSubClient mqttClient(wifiClient);
DHT          dht(DHT_PIN, DHT_TYPE);
Servo        irrigationServo;

char sensorTopic[64];
char statusTopic[64];
char commandTopic[64];

unsigned long lastPublish = 0;
bool irrigationOn = false;

// ─── Setup ────────────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n=== Smart Agriculture Node ===");
  Serial.printf("Device: %s\n", DEVICE_ID);

  dht.begin();
  analogReadResolution(12);

  irrigationServo.attach(SERVO_PIN);
  setIrrigation(false);  // start closed

  snprintf(sensorTopic,  sizeof(sensorTopic),  "%s/%s/sensors",  TOPIC_PREFIX, DEVICE_ID);
  snprintf(statusTopic,  sizeof(statusTopic),  "%s/%s/status",   TOPIC_PREFIX, DEVICE_ID);
  snprintf(commandTopic, sizeof(commandTopic), "%s/%s/commands", TOPIC_PREFIX, DEVICE_ID);

  connectWiFi();
  mqttClient.setServer(MQTT_BROKER, MQTT_PORT);
  mqttClient.setCallback(onMqttMessage);
  mqttClient.setBufferSize(512);
  connectMQTT();
}

// ─── Loop ─────────────────────────────────────────────────────────────────────
void loop() {
  if (!mqttClient.connected()) connectMQTT();
  mqttClient.loop();

  if (millis() - lastPublish >= PUBLISH_INTERVAL_MS) {
    lastPublish = millis();
    publishSensorData();
  }
}

// ─── WiFi ─────────────────────────────────────────────────────────────────────
void connectWiFi() {
  Serial.printf("Connecting to WiFi: %s", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  int tries = 0;
  while (WiFi.status() != WL_CONNECTED && tries < 30) {
    delay(500); Serial.print("."); tries++;
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\nConnected! IP: %s\n", WiFi.localIP().toString().c_str());
  } else {
    Serial.println("\nWiFi failed — check credentials. Restarting...");
    ESP.restart();
  }
}

// ─── MQTT ─────────────────────────────────────────────────────────────────────
void connectMQTT() {
  char clientId[40];
  snprintf(clientId, sizeof(clientId), "agri-%s-%lu", DEVICE_ID, millis());
  Serial.print("Connecting to MQTT...");
  int tries = 0;
  while (!mqttClient.connect(clientId) && tries < 5) {
    Serial.print("."); delay(2000); tries++;
  }
  if (mqttClient.connected()) {
    Serial.println(" connected!");
    mqttClient.subscribe(commandTopic);
    publishStatus("online");
  } else {
    Serial.println(" MQTT failed, will retry.");
  }
}

void publishStatus(const char* status) {
  StaticJsonDocument<128> doc;
  doc["status"]   = status;
  doc["deviceId"] = DEVICE_ID;
  char buf[128];
  serializeJson(doc, buf);
  mqttClient.publish(statusTopic, buf, true);
}

// ─── MQTT Command Handler ─────────────────────────────────────────────────────
void onMqttMessage(char* topic, byte* payload, unsigned int length) {
  payload[length] = '\0';
  Serial.printf("CMD [%s]: %s\n", topic, (char*)payload);

  StaticJsonDocument<256> doc;
  if (deserializeJson(doc, payload) == DeserializationError::Ok) {
    const char* cmd = doc["command"];
    if (strcmp(cmd, "irrigation") == 0) {
      bool state = doc["state"];
      setIrrigation(state);
    }
  }
}

// ─── Irrigation Control (Servo) ───────────────────────────────────────────────
void setIrrigation(bool on) {
  irrigationOn = on;
  // Servo: 0° = valve closed, 90° = valve open
  irrigationServo.write(on ? 90 : 0);
  Serial.printf("Irrigation: %s\n", on ? "ON (servo 90°)" : "OFF (servo 0°)");
}

// ─── Sensor Readings ──────────────────────────────────────────────────────────
float readSoilMoisture() {
  int raw = analogRead(SOIL_PIN);
  float pct = (float)(SOIL_DRY - raw) / (float)(SOIL_DRY - SOIL_WET) * 100.0;
  return constrain(pct, 0.0f, 100.0f);
}

int readLightLux() {
  int raw = analogRead(LIGHT_PIN);
  return map(raw, 0, 4095, 0, 1500);
}

// ─── Publish Sensor Data ──────────────────────────────────────────────────────
void publishSensorData() {
  float temperature  = dht.readTemperature();
  float humidity     = dht.readHumidity();
  float soilMoisture = readSoilMoisture();
  int   light        = readLightLux();

  if (isnan(temperature) || isnan(humidity)) {
    Serial.println("DHT11 read failed — check wiring on GPIO 4");
    return;
  }

  // Auto irrigation logic
  if (soilMoisture < MOISTURE_THRESHOLD_LOW && !irrigationOn) {
    Serial.println("Auto: soil dry — turning irrigation ON");
    setIrrigation(true);
  } else if (soilMoisture > MOISTURE_THRESHOLD_HIGH && irrigationOn) {
    Serial.println("Auto: soil wet enough — turning irrigation OFF");
    setIrrigation(false);
  }

  StaticJsonDocument<256> doc;
  doc["deviceId"]      = DEVICE_ID;
  doc["soilMoisture"]  = round(soilMoisture * 10) / 10.0;
  doc["temperature"]   = round(temperature * 10) / 10.0;
  doc["humidity"]      = round(humidity * 10) / 10.0;
  doc["light"]         = light;
  doc["irrigation"]    = irrigationOn;
  doc["timestamp"]     = millis();

  char buf[256];
  serializeJson(doc, buf);

  if (mqttClient.publish(sensorTopic, buf, false)) {
    Serial.printf("[OK] Moisture:%.1f%% Temp:%.1f°C Hum:%.1f%% Light:%d lux Irrigation:%s\n",
                  soilMoisture, temperature, humidity, (float)light,
                  irrigationOn ? "ON" : "OFF");
  } else {
    Serial.println("[FAIL] MQTT publish failed");
  }
}

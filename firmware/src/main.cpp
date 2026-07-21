#include <Arduino.h>
#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <ESP32Ping.h>

#include "config.h"

WebSocketsClient webSocket;
IPAddress pcHostIp;

unsigned long lastHeartbeatAt = 0;

// PC-power state shared between the blocking ping task (core 0) and the main
// loop (core 1), guarded by a spinlock. The ICMP probe is blocking (~3s when
// the PC is up, ~7s when it's off), so it must never run on the Arduino loop
// core or it starves webSocket.loop() and the heartbeat.
portMUX_TYPE pcStateMux = portMUX_INITIALIZER_UNLOCKED;
volatile bool pcPoweredOnKnown = false;
volatile bool pcPoweredOn = false;

// Main-task-only view of what we've last told the server, so we only emit a
// pc_status message when the value actually changes.
bool haveReportedPc = false;
bool reportedPcPoweredOn = false;

bool haveReportedGpio = false;
bool reportedLedOn = false;
bool reportedHddLedOn = false;

// Remote (server-issued) relay pulse, tracked non-blocking so it can run
// alongside continuous button mirroring.
bool remotePulseActive = false;
unsigned long remotePulseUntil = 0;
String remotePulseId;

bool lastButtonPressed = false;

void setRelay(bool energized) {
  bool level = RELAY_ACTIVE_LOW ? !energized : energized;
  digitalWrite(RELAY_PIN, level ? HIGH : LOW);
}

bool readButtonPressed() {
  int level = digitalRead(BUTTON_PIN);
  return BUTTON_ACTIVE_LOW ? (level == LOW) : (level == HIGH);
}

bool readLedOn() {
  int level = digitalRead(LED_PIN);
  return LED_ACTIVE_LOW ? (level == LOW) : (level == HIGH);
}

bool readHddLedOn() {
  int level = digitalRead(HDD_LED_PIN);
  return HDD_LED_ACTIVE_LOW ? (level == LOW) : (level == HIGH);
}

void sendAck(const String &id, bool ok, const char *error = nullptr) {
  JsonDocument doc;
  doc["type"] = "ack";
  doc["id"] = id;
  doc["ok"] = ok;
  if (error != nullptr) {
    doc["error"] = error;
  }
  String out;
  serializeJson(doc, out);
  webSocket.sendTXT(out);
}

void logButtonEvent(bool pressed) {
  JsonDocument doc;
  doc["type"] = "button";
  doc["pressed"] = pressed;
  String out;
  serializeJson(doc, out);
  webSocket.sendTXT(out);
}

void reportPcStatus(bool poweredOn) {
  JsonDocument doc;
  doc["type"] = "pc_status";
  doc["poweredOn"] = poweredOn;
  String out;
  serializeJson(doc, out);
  webSocket.sendTXT(out);
}

void reportGpioStatus(bool ledOn, bool hddLedOn) {
  JsonDocument doc;
  doc["type"] = "gpio_status";
  doc["ledOn"] = ledOn;
  doc["hddLedOn"] = hddLedOn;
  String out;
  serializeJson(doc, out);
  webSocket.sendTXT(out);
}

// Blocking ICMP probe of the motherboard's own NIC (PC_HOST_IP), separate from
// this ESP32's own connectivity. When the PC is fully off there's no OS to
// answer the ping, so no reply == powered off. Runs as its own FreeRTOS task
// pinned to core 0 (the Arduino loop runs on core 1) precisely because the
// probe blocks for seconds; results go into shared state and the main loop
// turns them into messages, since the WebSocket client is not thread-safe.
void pcPingTask(void *param) {
  for (;;) {
    bool poweredOn = Ping.ping(pcHostIp, PC_PING_COUNT);
    Serial.printf("pc ping %s: %s\n", pcHostIp.toString().c_str(), poweredOn ? "up" : "down");

    portENTER_CRITICAL(&pcStateMux);
    pcPoweredOnKnown = true;
    pcPoweredOn = poweredOn;
    portEXIT_CRITICAL(&pcStateMux);

    vTaskDelay(pdMS_TO_TICKS(PC_PING_INTERVAL_MS));
  }
}

// Main-loop side of the PC probe: push the latest state to the server when it
// changes. On reconnect we resend unconditionally (haveReportedPc is cleared on
// disconnect) because the server resets pc_status to null whenever the device
// drops (see DeviceState.disconnect).
void syncPcStatus() {
  if (!webSocket.isConnected()) {
    return;
  }

  bool known, poweredOn;
  portENTER_CRITICAL(&pcStateMux);
  known = pcPoweredOnKnown;
  poweredOn = pcPoweredOn;
  portEXIT_CRITICAL(&pcStateMux);

  if (!known) {
    return;
  }
  if (!haveReportedPc || poweredOn != reportedPcPoweredOn) {
    haveReportedPc = true;
    reportedPcPoweredOn = poweredOn;
    reportPcStatus(poweredOn);
  }
}

void syncGpioStatus() {
  if (!webSocket.isConnected()) {
    return;
  }

  bool ledOn = readLedOn();
  bool hddLedOn = readHddLedOn();

  if (!haveReportedGpio || ledOn != reportedLedOn || hddLedOn != reportedHddLedOn) {
    haveReportedGpio = true;
    reportedLedOn = ledOn;
    reportedHddLedOn = hddLedOn;
    reportGpioStatus(ledOn, hddLedOn);
  }
}

void handleMessage(uint8_t *payload, size_t length) {
  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, payload, length);
  if (err) {
    Serial.printf("failed to parse message: %s\n", err.c_str());
    return;
  }

  const char *type = doc["type"] | "";

  if (strcmp(type, "power") == 0) {
    String id = doc["id"] | "";
    long holdMs = doc["holdMs"] | 0;
    if (id.isEmpty() || holdMs <= 0) {
      Serial.println("power command missing id/holdMs");
      return;
    }
    Serial.printf("scheduling remote power pulse, holdMs=%ld\n", holdMs);
    remotePulseActive = true;
    remotePulseUntil = millis() + (unsigned long)holdMs;
    remotePulseId = id;
  } else if (strcmp(type, "pong") == 0) {
    // heartbeat acknowledged, nothing to do
  }
}

void onWebSocketEvent(WStype_t type, uint8_t *payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      Serial.println("websocket connected");
      // Force a resend of the current PC state on (re)connect; syncPcStatus()
      // picks it up on the next loop iteration once isConnected() is true.
      haveReportedPc = false;
      haveReportedGpio = false;
      break;
    case WStype_DISCONNECTED:
      Serial.println("websocket disconnected");
      haveReportedPc = false;
      haveReportedGpio = false;
      break;
    case WStype_TEXT:
      handleMessage(payload, length);
      break;
    default:
      break;
  }
}

void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.printf("connecting to wifi %s", WIFI_SSID);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.printf("\nwifi connected, ip=%s\n", WiFi.localIP().toString().c_str());
}

void setup() {
  Serial.begin(115200);

  pinMode(RELAY_PIN, OUTPUT);
  setRelay(false);

  pinMode(BUTTON_PIN, BUTTON_ACTIVE_LOW ? INPUT_PULLUP : INPUT);
  lastButtonPressed = readButtonPressed();

  pinMode(LED_PIN, LED_ACTIVE_LOW ? INPUT_PULLUP : INPUT);
  pinMode(HDD_LED_PIN, HDD_LED_ACTIVE_LOW ? INPUT_PULLUP : INPUT);

  pcHostIp.fromString(PC_HOST_IP);

  connectWiFi();

  String path = String(WS_PATH) + "?token=" + AUTH_TOKEN;
  if (SERVER_USE_TLS) {
    webSocket.beginSSL(SERVER_HOST, SERVER_PORT, path);
  } else {
    webSocket.begin(SERVER_HOST, SERVER_PORT, path);
  }
  webSocket.onEvent(onWebSocketEvent);
  webSocket.setReconnectInterval(RECONNECT_INTERVAL_MS);
  // WS-level ping/pong so a half-open socket is detected even if the app-level
  // heartbeat happens to be flowing; independent of the JSON "ping" the server
  // uses for staleness tracking.
  webSocket.enableHeartbeat(HEARTBEAT_INTERVAL_MS, WS_PONG_TIMEOUT_MS, WS_MISSED_PONGS_LIMIT);

  // Blocking ICMP probe lives on core 0 so it can never stall webSocket.loop()
  // (which runs on core 1 with the Arduino loop).
  xTaskCreatePinnedToCore(pcPingTask, "pcPing", 4096, nullptr, 1, nullptr, 0);
}

void loop() {
  webSocket.loop();

  // Raw, unfiltered mirror of the physical button straight to the relay.
  bool buttonPressed = readButtonPressed();
  if (buttonPressed != lastButtonPressed) {
    lastButtonPressed = buttonPressed;
    logButtonEvent(buttonPressed);
  }

  if (remotePulseActive && millis() >= remotePulseUntil) {
    remotePulseActive = false;
    sendAck(remotePulseId, true);
  }

  setRelay(buttonPressed || remotePulseActive);

  syncPcStatus();
  syncGpioStatus();

  unsigned long now = millis();
  if (now - lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS) {
    lastHeartbeatAt = now;
    if (webSocket.isConnected()) {
      webSocket.sendTXT("{\"type\":\"ping\"}");
    }
  }
}

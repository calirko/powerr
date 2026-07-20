#include <Arduino.h>
#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <ESP32Ping.h>

#include "config.h"

WebSocketsClient webSocket;
IPAddress pcHostIp;

unsigned long lastHeartbeatAt = 0;
unsigned long lastPcCheckAt = 0;
bool pcPoweredOnKnown = false;
bool lastPcPoweredOn = false;

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

// Blocking ICMP probe of the motherboard's own NIC (PC_HOST_IP), separate
// from this ESP32's own connectivity. When the PC is fully off there's no OS
// to answer the ping, so no reply == powered off.
void checkPcPower() {
  unsigned long now = millis();
  if (now - lastPcCheckAt < PC_PING_INTERVAL_MS) {
    return;
  }
  lastPcCheckAt = now;

  bool poweredOn = Ping.ping(pcHostIp, 1);
  if (!pcPoweredOnKnown || poweredOn != lastPcPoweredOn) {
    pcPoweredOnKnown = true;
    lastPcPoweredOn = poweredOn;
    if (webSocket.isConnected()) {
      reportPcStatus(poweredOn);
    }
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
      if (pcPoweredOnKnown) {
        reportPcStatus(lastPcPoweredOn);
      }
      break;
    case WStype_DISCONNECTED:
      Serial.println("websocket disconnected");
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

  checkPcPower();

  unsigned long now = millis();
  if (now - lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS) {
    lastHeartbeatAt = now;
    if (webSocket.isConnected()) {
      webSocket.sendTXT("{\"type\":\"ping\"}");
    }
  }
}

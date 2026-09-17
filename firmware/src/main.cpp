#include <Arduino.h>
#include <ArduinoJson.h>
#include <ESP32Ping.h>
#include <WebSocketsClient.h>
#include <WiFi.h>

#include "config.h"
#include "secrets.h"
#include "status_led.h"

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

WebSocketsClient webSocket;
StatusLed statusLed(STATUS_LED_PIN, STATUS_LED_ACTIVE_LOW);

// WiFi association attempt tracking (see maintainWiFi()).
bool wifiWasConnected = false;
unsigned long wifiAttemptStartedAt = 0;

unsigned long lastHeartbeatAt = 0;
unsigned long lastDeviceInfoAt = 0;

// Runtime settings pushed by the server in a `config` message on every connect
// (see server/src/device-config.ts). Until one arrives the PC probe is idle and
// the rest use these defaults. Shared with the ping task, so guarded by
// configMux.
struct DeviceConfig {
  bool hasPcHost = false;
  IPAddress pcHost;
  unsigned long pcPingIntervalMs = 5000;
  uint8_t pcPingCount = 4;
  unsigned long heartbeatIntervalMs = 3000;
  unsigned long longHoldThresholdMs = 2000;
};
portMUX_TYPE configMux = portMUX_INITIALIZER_UNLOCKED;
DeviceConfig config;

DeviceConfig currentConfig() {
  portENTER_CRITICAL(&configMux);
  DeviceConfig copy = config;
  portEXIT_CRITICAL(&configMux);
  return copy;
}

// PC-power reading, written by the ping task (core 0) and read by the main
// loop (core 1), guarded by a spinlock. The ICMP probe blocks for seconds, so
// it must never run on the loop core or it starves webSocket.loop().
portMUX_TYPE pcStateMux = portMUX_INITIALIZER_UNLOCKED;
bool pcStateKnown = false;
bool pcPoweredOn = false;
// Per-probe ICMP stats, so the UI can show packet loss and reply time rather
// than just up/down. pcProbeSeq increments once per completed probe and is what
// the loop watches to decide there's something new to report.
uint8_t pcPingSent = 0;
uint8_t pcPingReceived = 0;
float pcPingReplyMs = 0;
uint32_t pcProbeSeq = 0;

// What we last told the server, so status messages are only sent on change.
// Cleared on every (re)connect since the server resets its view to unknown
// whenever the device drops (see DeviceState.disconnect).
struct ReportedState {
  bool pcKnown = false;
  bool pcPoweredOn = false;
  uint32_t pcProbeSeq = 0;
  bool gpioKnown = false;
  bool chassisLedOn = false;
  bool hddLedOn = false;
} reported;

// Server-issued relay pulse, timed with millis() so it runs alongside the
// button mirror instead of blocking the loop.
struct RemotePulse {
  bool active = false;
  unsigned long startedAt = 0;
  unsigned long holdMs = 0;
  String id;
} remotePulse;

bool lastButtonPressed = false;

// ---------------------------------------------------------------------------
// GPIO helpers
// ---------------------------------------------------------------------------

bool readActive(uint8_t pin, bool activeLow) {
  return (digitalRead(pin) == LOW) == activeLow;
}

void setRelay(bool energized) {
  digitalWrite(RELAY_PIN, (energized != RELAY_ACTIVE_LOW) ? HIGH : LOW);
}

// ---------------------------------------------------------------------------
// Outgoing messages (shapes mirror DeviceToServerMessage in server/src/types.ts)
// ---------------------------------------------------------------------------

void sendJson(const JsonDocument &doc) {
  if (!webSocket.isConnected()) {
    return;
  }
  String out;
  serializeJson(doc, out);
  webSocket.sendTXT(out);
}

void sendHeartbeat() {
  JsonDocument doc;
  doc["type"] = "ping";
  sendJson(doc);
}

void sendAck(const String &id, bool ok, const char *error = nullptr) {
  JsonDocument doc;
  doc["type"] = "ack";
  doc["id"] = id;
  doc["ok"] = ok;
  if (error != nullptr) {
    doc["error"] = error;
  }
  sendJson(doc);
}

void sendButtonEvent(bool pressed) {
  JsonDocument doc;
  doc["type"] = "button";
  doc["pressed"] = pressed;
  sendJson(doc);
}

void sendPcStatus(bool poweredOn, uint8_t sent, uint8_t received, float replyMs) {
  JsonDocument doc;
  doc["type"] = "pc_status";
  doc["poweredOn"] = poweredOn;
  doc["sent"] = sent;
  doc["received"] = received;
  // Only meaningful when something replied; the server treats 0 as "no reading".
  doc["replyMs"] = received > 0 ? replyMs : 0;
  sendJson(doc);
}

// A snapshot of the board itself, for the ESP32 dialog in the UI. Nothing here
// drives behaviour, so it's sent on a slow timer instead of on change.
void sendDeviceInfo() {
  JsonDocument doc;
  doc["type"] = "device_info";
  doc["ssid"] = WiFi.SSID();
  doc["rssi"] = WiFi.RSSI();
  doc["channel"] = WiFi.channel();
  doc["ip"] = WiFi.localIP().toString();
  doc["mac"] = WiFi.macAddress();
  doc["hostname"] = WiFi.getHostname();
  doc["uptimeMs"] = (uint32_t)millis();
  doc["freeHeapBytes"] = ESP.getFreeHeap();
  doc["heapSizeBytes"] = ESP.getHeapSize();
  doc["chipModel"] = ESP.getChipModel();
  doc["chipCores"] = ESP.getChipCores();
  doc["cpuFreqMhz"] = getCpuFrequencyMhz();
  doc["sdkVersion"] = ESP.getSdkVersion();
  doc["temperatureC"] = temperatureRead();
  sendJson(doc);
}

void sendGpioStatus(bool chassisLedOn, bool hddLedOn) {
  JsonDocument doc;
  doc["type"] = "gpio_status";
  doc["ledOn"] = chassisLedOn;
  doc["hddLedOn"] = hddLedOn;
  sendJson(doc);
}

// ---------------------------------------------------------------------------
// PC power probe
// ---------------------------------------------------------------------------

// ICMP-pings the motherboard's own NIC (pcHostIp from the server config). When the PC is fully off
// there's no OS to answer, so no reply == powered off. Results go into shared
// state and the main loop turns them into messages, because the WebSocket
// client is not thread-safe.
// PingClass keeps its per-probe counters as protected statics and exposes only
// "did anything reply", so a derived type is the only way to read the reply
// count without patching the library.
struct PingCounters : private PingClass {
  static uint8_t received() { return _success; }
};

void pcPingTask(void *) {
  for (;;) {
    DeviceConfig cfg = currentConfig();
    if (!WiFi.isConnected() || !cfg.hasPcHost) {
      // A reading from before a WiFi drop can't be trusted, and without a host
      // from the server there's nothing to probe.
      portENTER_CRITICAL(&pcStateMux);
      pcStateKnown = false;
      portEXIT_CRITICAL(&pcStateMux);
      vTaskDelay(pdMS_TO_TICKS(1000));
      continue;
    }

    bool up = Ping.ping(cfg.pcHost, cfg.pcPingCount);
    uint8_t received = PingCounters::received();
    float replyMs = Ping.averageTime();
    DeviceConfig after = currentConfig();
    // Drop the result if the target changed while the (seconds-long) probe ran.
    if (after.hasPcHost && after.pcHost == cfg.pcHost) {
      portENTER_CRITICAL(&pcStateMux);
      bool changed = !pcStateKnown || pcPoweredOn != up;
      pcStateKnown = true;
      pcPoweredOn = up;
      pcPingSent = cfg.pcPingCount;
      pcPingReceived = received;
      pcPingReplyMs = replyMs;
      pcProbeSeq++;
      portEXIT_CRITICAL(&pcStateMux);
      if (changed) {
        Serial.printf("[pc] %s is %s\n", cfg.pcHost.toString().c_str(), up ? "up" : "down");
      }
    }
    vTaskDelay(pdMS_TO_TICKS(cfg.pcPingIntervalMs));
  }
}

// Sent once per completed probe rather than only on change, so the UI's ping
// dialog can show a fresh "last checked" time and loss figure.
void syncPcStatus() {
  bool known, poweredOn;
  uint8_t sent, received;
  float replyMs;
  uint32_t seq;
  portENTER_CRITICAL(&pcStateMux);
  known = pcStateKnown;
  poweredOn = pcPoweredOn;
  sent = pcPingSent;
  received = pcPingReceived;
  replyMs = pcPingReplyMs;
  seq = pcProbeSeq;
  portEXIT_CRITICAL(&pcStateMux);

  if (!known || (reported.pcKnown && seq == reported.pcProbeSeq)) {
    return;
  }
  reported.pcKnown = true;
  reported.pcPoweredOn = poweredOn;
  reported.pcProbeSeq = seq;
  sendPcStatus(poweredOn, sent, received, replyMs);
}

void syncGpioStatus() {
  bool chassisLedOn = readActive(CHASSIS_LED_PIN, CHASSIS_LED_ACTIVE_LOW);
  bool hddLedOn = readActive(HDD_LED_PIN, HDD_LED_ACTIVE_LOW);

  if (reported.gpioKnown && chassisLedOn == reported.chassisLedOn && hddLedOn == reported.hddLedOn) {
    return;
  }
  reported.gpioKnown = true;
  reported.chassisLedOn = chassisLedOn;
  reported.hddLedOn = hddLedOn;
  sendGpioStatus(chassisLedOn, hddLedOn);
}

// ---------------------------------------------------------------------------
// Remote power commands
// ---------------------------------------------------------------------------

bool isLongHold(unsigned long holdMs) {
  return holdMs >= currentConfig().longHoldThresholdMs;
}

void startRemotePulse(const String &id, long holdMs) {
  if (remotePulse.active) {
    sendAck(id, false, "a power pulse is already in progress");
    return;
  }
  if (holdMs <= 0 || (unsigned long)holdMs > MAX_REMOTE_HOLD_MS) {
    sendAck(id, false, "holdMs out of range");
    return;
  }

  Serial.printf("[power] remote pulse started, holdMs=%ld\n", holdMs);
  remotePulse.active = true;
  remotePulse.startedAt = millis();
  remotePulse.holdMs = (unsigned long)holdMs;
  remotePulse.id = id;
}

// Ends the pulse once its hold time has elapsed. The ack is sent only after
// the relay is released, so the server's response reflects a completed press.
// If the socket dropped mid-pulse the pulse still completes; the ack is lost
// and the server times the command out.
void updateRemotePulse() {
  if (!remotePulse.active || millis() - remotePulse.startedAt < remotePulse.holdMs) {
    return;
  }
  remotePulse.active = false;
  Serial.println("[power] remote pulse finished");
  sendAck(remotePulse.id, true);
  statusLed.flash(isLongHold(remotePulse.holdMs) ? 3 : 1);
}

// ---------------------------------------------------------------------------
// WebSocket
// ---------------------------------------------------------------------------

void applyConfig(const JsonDocument &doc) {
  DeviceConfig next = currentConfig();

  const char *host = doc["pcHostIp"] | "";
  IPAddress parsed;
  next.hasPcHost = *host != '\0' && parsed.fromString(host);
  next.pcHost = next.hasPcHost ? parsed : IPAddress();

  long pingInterval = doc["pcPingIntervalMs"] | 0L;
  if (pingInterval >= 1000) next.pcPingIntervalMs = pingInterval;
  long pingCount = doc["pcPingCount"] | 0L;
  if (pingCount >= 1 && pingCount <= 20) next.pcPingCount = pingCount;
  long heartbeat = doc["heartbeatIntervalMs"] | 0L;
  if (heartbeat >= 500) next.heartbeatIntervalMs = heartbeat;
  long longHold = doc["longHoldThresholdMs"] | 0L;
  if (longHold > 0) next.longHoldThresholdMs = longHold;

  DeviceConfig prev = currentConfig();
  bool hostChanged = prev.hasPcHost != next.hasPcHost || prev.pcHost != next.pcHost;

  portENTER_CRITICAL(&configMux);
  config = next;
  portEXIT_CRITICAL(&configMux);

  if (hostChanged) {
    // A reading for the old target says nothing about the new one.
    portENTER_CRITICAL(&pcStateMux);
    pcStateKnown = false;
    portEXIT_CRITICAL(&pcStateMux);
    reported.pcKnown = false;
  }

  Serial.printf("[config] pcHost=%s ping=%lums x%u heartbeat=%lums longHold=%lums\n",
                next.hasPcHost ? next.pcHost.toString().c_str() : "(none)", next.pcPingIntervalMs,
                next.pcPingCount, next.heartbeatIntervalMs, next.longHoldThresholdMs);
}

void handleMessage(const uint8_t *payload, size_t length) {
  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, payload, length);
  if (err) {
    Serial.printf("[ws] failed to parse message: %s\n", err.c_str());
    return;
  }

  const char *type = doc["type"] | "";
  if (strcmp(type, "power") == 0) {
    const char *id = doc["id"] | "";
    if (*id == '\0') {
      Serial.println("[ws] power command without id, ignoring");
      return;
    }
    startRemotePulse(id, doc["holdMs"] | 0L);
  } else if (strcmp(type, "config") == 0) {
    applyConfig(doc);
  } else if (strcmp(type, "pong") == 0) {
    // Heartbeat acknowledged; liveness is tracked by the WS-level ping/pong.
  } else {
    Serial.printf("[ws] unknown message type '%s'\n", type);
  }
}

void onWebSocketEvent(WStype_t type, uint8_t *payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      Serial.println("[ws] connected");
      reported = ReportedState{};
      lastHeartbeatAt = 0;
      lastDeviceInfoAt = 0;
      break;
    case WStype_DISCONNECTED:
      Serial.println("[ws] disconnected");
      break;
    case WStype_TEXT:
      handleMessage(payload, length);
      break;
    default:
      break;
  }
}

void beginWebSocket() {
  String path = String(WS_PATH) + "?token=" + AUTH_TOKEN;
  if (SERVER_USE_TLS) {
    webSocket.beginSSL(SERVER_HOST, SERVER_PORT, path.c_str());
  } else {
    webSocket.begin(SERVER_HOST, SERVER_PORT, path.c_str());
  }
  webSocket.onEvent(onWebSocketEvent);
  webSocket.setReconnectInterval(WS_RECONNECT_INTERVAL_MS);
  webSocket.enableHeartbeat(WS_PING_INTERVAL_MS, WS_PONG_TIMEOUT_MS, WS_MISSED_PONGS_LIMIT);
}

void maintainDeviceInfo() {
  unsigned long now = millis();
  if (lastDeviceInfoAt == 0 || now - lastDeviceInfoAt >= DEVICE_INFO_INTERVAL_MS) {
    lastDeviceInfoAt = now;
    sendDeviceInfo();
  }
}

void maintainHeartbeat() {
  unsigned long now = millis();
  if (lastHeartbeatAt == 0 || now - lastHeartbeatAt >= currentConfig().heartbeatIntervalMs) {
    lastHeartbeatAt = now;
    sendHeartbeat();
  }
}

// ---------------------------------------------------------------------------
// WiFi
// ---------------------------------------------------------------------------

void startWiFiAttempt() {
  Serial.printf("[wifi] connecting to %s\n", WIFI_SSID);
  WiFi.disconnect();
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  wifiAttemptStartedAt = millis();
}

// Non-blocking WiFi supervision: logs transitions and restarts the association
// if an attempt hangs, so the loop (and button mirroring) never stalls on it.
// Returns whether WiFi is currently up.
bool maintainWiFi() {
  bool connected = WiFi.isConnected();

  if (connected != wifiWasConnected) {
    wifiWasConnected = connected;
    if (connected) {
      Serial.printf("[wifi] connected, ip=%s rssi=%d\n", WiFi.localIP().toString().c_str(), WiFi.RSSI());
    } else {
      Serial.println("[wifi] connection lost");
      webSocket.disconnect();
      wifiAttemptStartedAt = millis();
    }
  }

  if (!connected && millis() - wifiAttemptStartedAt >= WIFI_CONNECT_TIMEOUT_MS) {
    startWiFiAttempt();
  }
  return connected;
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

void setup() {
  // Drive the relay inactive before enabling the output so boot never glitches
  // the PC's power switch.
  setRelay(false);
  pinMode(RELAY_PIN, OUTPUT);

  pinMode(BUTTON_PIN, BUTTON_ACTIVE_LOW ? INPUT_PULLUP : INPUT_PULLDOWN);
  pinMode(CHASSIS_LED_PIN, CHASSIS_LED_ACTIVE_LOW ? INPUT_PULLUP : INPUT_PULLDOWN);
  pinMode(HDD_LED_PIN, HDD_LED_ACTIVE_LOW ? INPUT_PULLUP : INPUT_PULLDOWN);
  lastButtonPressed = readActive(BUTTON_PIN, BUTTON_ACTIVE_LOW);

  statusLed.begin();

  Serial.begin(115200);
  Serial.println("\n[boot] powerr firmware (XIAO ESP32-S3)");

  WiFi.mode(WIFI_STA);
  WiFi.setHostname("powerr");
  WiFi.setAutoReconnect(true);
  startWiFiAttempt();

  beginWebSocket();

  // Blocking ICMP probe lives on core 0 so it can't stall the loop on core 1.
  xTaskCreatePinnedToCore(pcPingTask, "pcPing", 4096, nullptr, 1, nullptr, 0);
}

void loop() {
  bool wifiUp = maintainWiFi();
  if (wifiUp) {
    webSocket.loop();
  }
  bool serverUp = wifiUp && webSocket.isConnected();

  // Raw, unfiltered mirror of the physical button straight to the relay.
  bool buttonPressed = readActive(BUTTON_PIN, BUTTON_ACTIVE_LOW);
  if (buttonPressed != lastButtonPressed) {
    lastButtonPressed = buttonPressed;
    Serial.printf("[button] %s\n", buttonPressed ? "pressed" : "released");
    sendButtonEvent(buttonPressed);
  }

  updateRemotePulse();
  setRelay(buttonPressed || remotePulse.active);

  if (serverUp) {
    maintainHeartbeat();
    maintainDeviceInfo();
    syncPcStatus();
    syncGpioStatus();
  }

  statusLed.setMode(!wifiUp     ? StatusLed::Mode::WifiConnecting
                    : !serverUp ? StatusLed::Mode::ServerConnecting
                                : StatusLed::Mode::Idle);
  statusLed.setActivity(buttonPressed        ? StatusLed::Activity::ButtonHeld
                        : !remotePulse.active ? StatusLed::Activity::None
                        : isLongHold(remotePulse.holdMs) ? StatusLed::Activity::LongHold
                                                         : StatusLed::Activity::ShortHold);
  statusLed.update();

  delay(1);  // yield to the idle task / WiFi stack
}

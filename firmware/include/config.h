#pragma once

#include <Arduino.h>

// Non-secret tuning for the Seeed Studio XIAO ESP32-S3 (Sense). Pin names use
// the board's silkscreen labels (D0..D10); see the variant's pins_arduino.h
// for the GPIO numbers behind them.

// ---------------------------------------------------------------------------
// Pins
// ---------------------------------------------------------------------------

// D0 (GPIO1) is intentionally left unused.

// Relay bridging the motherboard's power-switch header.
constexpr uint8_t RELAY_PIN = D1; // GPIO2
// This module is active-high (HIGH = energized).
constexpr bool RELAY_ACTIVE_LOW = false;

// PC case power button, wired to GND with the internal pull-up. Its raw state
// is mirrored straight to the relay (no debounce/filtering) so the physical
// button keeps working as before; every transition is logged to the server.
constexpr uint8_t BUTTON_PIN = D2; // GPIO3
constexpr bool BUTTON_ACTIVE_LOW = true;

// Motherboard LED headers are read through optocouplers whose output side
// switches 3V3 onto the GPIO, so these inputs use the internal pull-down and
// read HIGH while the LED is lit (active-high).

// Chassis power LED status line from the motherboard header.
constexpr uint8_t CHASSIS_LED_PIN = D3; // GPIO4
constexpr bool CHASSIS_LED_ACTIVE_LOW = false; // INPUT_PULLDOWN

// HDD activity LED status line from the motherboard header.
constexpr uint8_t HDD_LED_PIN = D4; // GPIO5
constexpr bool HDD_LED_ACTIVE_LOW = false; // INPUT_PULLDOWN

// On-board orange user LED, used as a status indicator (see status_led.h).
// It's wired active-low on the XIAO ESP32-S3.
constexpr uint8_t STATUS_LED_PIN = LED_BUILTIN; // GPIO21
constexpr bool STATUS_LED_ACTIVE_LOW = true;

// ---------------------------------------------------------------------------
// Connectivity
// ---------------------------------------------------------------------------

constexpr const char *WS_PATH = "/ws";

// How long a single WiFi association attempt may take before we reset the
// radio and try again.
constexpr unsigned long WIFI_CONNECT_TIMEOUT_MS = 15000;

// The app-level JSON heartbeat interval, PC probe target/timing and long-hold
// threshold are runtime settings pushed by the server on connect; see
// server/src/device-config.ts and DeviceConfig in main.cpp.

// How often the device re-sends its `device_info` snapshot (WiFi signal, heap,
// uptime) while connected. Also sent immediately on every WS connect.
constexpr unsigned long DEVICE_INFO_INTERVAL_MS = 15000;

// WebSocket reconnect backoff when the socket drops.
constexpr unsigned long WS_RECONNECT_INTERVAL_MS = 5000;

// WebSocket-level ping/pong, used to detect a half-open socket independently
// of the JSON heartbeat: ping interval, how long to wait for each pong, and how
// many consecutive misses force a reconnect.
constexpr unsigned long WS_PING_INTERVAL_MS = 3000;
constexpr unsigned long WS_PONG_TIMEOUT_MS = 3000;
constexpr uint8_t WS_MISSED_PONGS_LIMIT = 2;

// ---------------------------------------------------------------------------
// Remote power commands
// ---------------------------------------------------------------------------

// Upper bound on a server-issued relay pulse, as a firmware-side safety net
// (the server already validates holdMs; keep this >= its MAX_HOLD_MS).
constexpr unsigned long MAX_REMOTE_HOLD_MS = 10000;

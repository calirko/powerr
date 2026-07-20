#pragma once

#include "secrets.h"

// GPIO driving the relay that bridges the motherboard's power switch header.
#define RELAY_PIN 26
// Relay module polarity: most cheap modules are active-low (LOW = energized).
#define RELAY_ACTIVE_LOW true

// GPIO reading the PC case's physical power button, wired in parallel with
// the original switch. Its raw state is mirrored straight to the relay
// (no debounce/filtering) so the physical button keeps working as before;
// every transition is still logged up to the server.
#define BUTTON_PIN 27
// Typical wiring: button to GND with internal pull-up, so pressed == LOW.
#define BUTTON_ACTIVE_LOW true

#define WS_PATH "/ws"

// How often we ping the server so it can tell we're still alive.
#define HEARTBEAT_INTERVAL_MS 3000
// Reconnect backoff when the WS drops.
#define RECONNECT_INTERVAL_MS 5000

// How often we probe the motherboard's NIC (PC_HOST_IP, see secrets.h) to
// tell whether the PC itself is powered on. This is a blocking ICMP ping, so
// keep the interval well above the ping timeout to avoid stalling the button
// mirror / heartbeat loop for too long.
#define PC_PING_INTERVAL_MS 5000

#include "status_led.h"

namespace {

constexpr unsigned long WIFI_BLINK_HALF_MS = 100;
constexpr unsigned long SERVER_BLINK_HALF_MS = 600;
constexpr unsigned long IDLE_PERIOD_MS = 4000;
constexpr unsigned long IDLE_BLIP_MS = 40;
constexpr unsigned long STROBE_HALF_MS = 60;
constexpr unsigned long FLASH_HALF_MS = 120;

bool squareWave(unsigned long elapsed, unsigned long halfPeriod) {
  return (elapsed / halfPeriod) % 2 == 0;
}

}  // namespace

StatusLed::StatusLed(uint8_t pin, bool activeLow) : pin_(pin), activeLow_(activeLow) {}

void StatusLed::begin() {
  pinMode(pin_, OUTPUT);
  lastWritten_ = true;  // force the first write through
  write(false);
  phaseStartedAt_ = millis();
}

void StatusLed::setMode(Mode mode) {
  if (mode == mode_) {
    return;
  }
  mode_ = mode;
  phaseStartedAt_ = millis();
}

void StatusLed::setActivity(Activity activity) {
  if (activity == activity_) {
    return;
  }
  activity_ = activity;
  phaseStartedAt_ = millis();
}

void StatusLed::flash(uint8_t count) {
  // Start with an "off" gap so the flashes are distinguishable from whatever
  // was lit right before (e.g. a solid-on hold).
  flashPhases_ = count * 2 + 1;
  flashPhaseAt_ = millis();
}

void StatusLed::update() {
  unsigned long now = millis();
  unsigned long elapsed = now - phaseStartedAt_;

  switch (activity_) {
    case Activity::ButtonHeld:
    case Activity::ShortHold:
      write(true);
      return;
    case Activity::LongHold:
      write(squareWave(elapsed, STROBE_HALF_MS));
      return;
    case Activity::None:
      break;
  }

  if (flashPhases_ > 0) {
    if (now - flashPhaseAt_ >= FLASH_HALF_MS) {
      flashPhaseAt_ = now;
      flashPhases_--;
      if (flashPhases_ == 0) {
        // Resume the background pattern from the start of a cycle.
        phaseStartedAt_ = now;
      }
    }
    // Odd phase counts are the gaps (see flash()).
    write(flashPhases_ > 0 && flashPhases_ % 2 == 0);
    return;
  }

  switch (mode_) {
    case Mode::WifiConnecting:
      write(squareWave(elapsed, WIFI_BLINK_HALF_MS));
      break;
    case Mode::ServerConnecting:
      write(squareWave(elapsed, SERVER_BLINK_HALF_MS));
      break;
    case Mode::Idle:
      write(elapsed % IDLE_PERIOD_MS < IDLE_BLIP_MS);
      break;
  }
}

void StatusLed::write(bool on) {
  if (on == lastWritten_) {
    return;
  }
  lastWritten_ = on;
  digitalWrite(pin_, (on != activeLow_) ? HIGH : LOW);
}

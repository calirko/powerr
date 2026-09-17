#pragma once

#include <Arduino.h>

// Non-blocking driver for the on-board status LED. The LED shows a steady
// background pattern for the current connection state, and relay activity
// overrides it while it's happening:
//
//   WifiConnecting   fast blink        (100ms on / 100ms off)
//   ServerConnecting slow blink        (600ms on / 600ms off)
//   Idle             heartbeat blip    (40ms flash every 4s)
//   Button held      solid on
//   Short remote hold solid on for the pulse, then 1 confirmation flash
//   Long remote hold  strobe for the pulse, then 3 confirmation flashes
class StatusLed {
 public:
  enum class Mode { WifiConnecting, ServerConnecting, Idle };
  enum class Activity { None, ButtonHeld, ShortHold, LongHold };

  StatusLed(uint8_t pin, bool activeLow);

  void begin();
  void setMode(Mode mode);
  void setActivity(Activity activity);
  // Queue `count` quick flashes, shown once no activity is in progress.
  void flash(uint8_t count);
  void update();

 private:
  void write(bool on);

  uint8_t pin_;
  bool activeLow_;
  Mode mode_ = Mode::WifiConnecting;
  Activity activity_ = Activity::None;
  unsigned long phaseStartedAt_ = 0;
  // Remaining on/off half-cycles of a queued flash sequence.
  uint8_t flashPhases_ = 0;
  unsigned long flashPhaseAt_ = 0;
  bool lastWritten_ = false;
};

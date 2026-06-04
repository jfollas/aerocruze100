# Aerocruze 100 Autopilot Simulator

An interactive web simulator for the **BendixKing Aerocruze 100** autopilot (the
rebranded TruTrak Vizion PMA). It lets pilots practice the *buttonology* — the
MODE/ALT buttons and the twist/press/hold knob — and see how the LCD responds in
every mode, before flying with the real unit.

> For familiarization training only. **Not** for navigation or flight use.

## Features

- Photo-realistic front panel for **both** physical variants (flat rectangular
  panel and the 2-inch round unit), switchable, sharing one simulation engine.
- A simulated LCD overlaid on the photo's glass, rendering the display states
  described in the *TT-167 Vizion PMA Operating Handbook* (`assets/`):
  power-up, altimeter sync, engage/disengage, lateral modes (TRK / GPS NAV /
  GPSS / gyro-backup BANK), vertical modes (SVS / ALT HOLD / Altitude Select /
  Pre-Select / Vertical Approach GS ARM→CPLD→FLG), Aspen & G5 modes, CWS,
  contrast/backlight setup, and safety annunciations (Emergency Level, AEP,
  Sensor Error, Min/Max airspeed).
- A **light flight model**: actual track and altitude animate toward selected
  targets, so climbs, ALT-HOLD capture, and glideslope sequencing feel real.
- A config panel to set conditions (GPS signal/data type, ARINC source, ground
  speed, LPV approach) and induce events (trim, airspeed limits, bank/AEP,
  sensor error).

## Controls

- **MODE / ALT** — click/tap the buttons on the device.
- **Knob** — drag around its center to twist (CW/CCW); tap to press; hold to
  disengage. Hold briefly *before* twisting for fine increments.
- **Keyboard** — `M` mode · `A` alt · `←`/`→` twist (`Shift` = fine) ·
  `Enter` press · `Backspace` hold/disengage.

## Develop

```bash
npm install
npm run dev      # http://localhost:5173
npm run test     # vitest — the state machine is unit-tested against the handbook
npm run build    # static production build in dist/
```

## Layout

- `src/sim/machine.js` — the autopilot state machine (pure reducer). The heart.
- `src/sim/flight.js` — the light flight model.
- `src/sim/screens.js` — derives the LCD display model from state.
- `src/components/` — `Device`, `LcdDisplay`, `Knob`, `ConfigPanel`.
- `assets/` — the operating handbook PDF and the two product photos.

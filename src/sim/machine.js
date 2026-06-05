// The autopilot state machine — a pure reducer faithful to the TT-167 Vizion PMA
// Operating Handbook (the Aerocruze 100 is the rebranded unit). reducer(state, event)
// returns the next state. All section references (§) point at that handbook.

import * as E from './events.js'
import { stepFlight, mod360 } from './flight.js'
import { stepScenario } from './scenario.js'
import { FIX_XY, FIELD_ELEV, bearingToTrue, trueToMag } from './geo.js'
import { PLANS } from './navplan.js'

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x))
const round = (x, step) => Math.round(x / step) * step

export const DEFAULT_BARO = 1352 // matches handbook figure 5.1a; reset on power cycle

export const initialState = {
  power: 'off', // 'off' | 'booting' | 'on'
  apEngaged: false,
  screen: 'NORMAL', // NORMAL | SEL_ALT | ALT_SYNC | CONTRAST | MIN_BKLT | SETUP | GYRO_TRIM

  lateralMode: 'TRK', // TRK | GPSNAV | GPSS | ASPEN | EXT
  verticalMode: null, // null | SVS | ALTHOLD | SEL | GS_ARM | GS_CPLD | GS_FLG

  selTrack: 0,
  selVS: 0,
  selAlt: 3000,
  selBank: 0, // gyro-backup selected bank angle
  baro: DEFAULT_BARO,
  contrast: 7,
  minBklt: 7,
  gyroTrim: 0,

  cursor: 'track', // track | vs | altSel
  altTouched: false, // whether selAlt was rotated since entering the SEL ALT setup
  preselectArmed: false,
  emergencyLevel: false,
  cwsHeld: false,
  aep: 'stby', // off | stby | active — standby by default & after each power cycle (§8.2)
  warning: null, // null | SENSOR | MIN_AS | MAX_AS

  // sim-driven actual values
  curTrack: 0,
  curAlt: 1500,
  curVS: 0,
  curIAS: 0, // indicated airspeed (kt) — drives the PFD speed tape
  pitch: 0, // pitch attitude (deg, + nose up) — drives the PFD horizon
  bankAngle: 0,
  groundSpeed: 0,

  // config (set via SET_CONFIG)
  gpsStatus: 'NOGPS', // NOGPS | NOFIX | OK
  gpsData: 'none', // none | portable (RS232 -> GPS NAV) | ifr (ARINC429 -> GPSS)
  arinc: 'none', // none | aspen (A) | g5 (E)
  approachActive: false,
  glideslopeFlagged: false,
  lpvPhase: null, // LPV approach phase: null | TURN | ARM | CPLD
  gsDist: null, // NM to the threshold while on the LPV approach
  gsDev: 0, // glideslope deviation in dots (+ = beam above, fly up); for the GSI
  gpsDtk: null, // desired track of the active GPS leg (deg mag); drives the HSI needle

  // RNAV (GPS) RWY 10 scenario (to-scale map + profile). When active, the
  // position-based scenario engine flies the published approach.
  scenarioActive: false,
  scenarioIaf: null, // 'LEYIR' | 'WUDAT' — chosen initial approach fix
  curX: 0, // aircraft position east of the field (nm)
  curY: 0, // aircraft position north of the field (nm)
  activeLeg: 0, // index of the active leg in PLANS[scenarioIaf]
  agl: undefined, // height above field (ft); drives the 700-AGL warning
  inducedBank: 0, // for AEP demonstration while disengaged
  trim: 'none', // none | up | dn — trim annunciation (§4.3)

  // Dynon SkyView interface (Installation Manual §10)
  skyview: 'off', // off | on — a SkyView is connected and sending a signal
  skyviewCdi: 'heading', // heading | flightplan | navaid — SkyView CDI source
  svHeadingBug: 160, // SkyView heading bug (deg)
  svAltBug: 3500, // SkyView altitude bug (ft)
  svAltBugSet: true, // whether an altitude bug is set on the SkyView
  svVsBug: 500, // SkyView vertical-speed bug (fpm)

  // timers (seconds)
  bootTimer: 0,
  emergencyTimer: 0,
  gsTimer: 0,
}

// ---- derived helpers (also used by screens.js) ----

// Lateral modes reachable by cycling MODE, given the connected equipment.
export function lateralCycle(s) {
  const list = ['TRK']
  if (s.gpsData === 'portable') list.push('GPSNAV')
  if (s.gpsData === 'ifr') list.push('GPSS')
  if (s.arinc === 'aspen') list.push('ASPEN')
  if (s.arinc === 'g5') list.push('EXT')
  return list
}

// True when the engaged AP has no valid track and shows BANK / gyro-backup (§4.1.2, §8.3).
export function isGyro(s) {
  return s.apEngaged && s.gpsStatus !== 'OK' && !s.emergencyLevel && s.lateralMode !== 'SKYVIEW'
}

// ---- reducer ----

export function reducer(state, event) {
  switch (event.type) {
    case E.SET_CONFIG:
      return applyConfig(state, event)
    case E.TICK:
      return onTick(state, event.dt)
    default:
      break
  }
  if (state.power !== 'on') {
    // While booting, a knob press enters the contrast/setup menu (§4.4).
    if (state.power === 'booting' && event.type === E.KNOB_PRESS) {
      return { ...state, power: 'on', bootTimer: 0, screen: 'CONTRAST', cursor: 'contrast' }
    }
    return state
  }

  switch (event.type) {
    case E.MODE:
      return onMode(state)
    case E.ALT:
      return onAlt(state)
    case E.KNOB_CW:
      return rotate(state, +1, event.fine)
    case E.KNOB_CCW:
      return rotate(state, -1, event.fine)
    case E.KNOB_PRESS:
      return onKnobPress(state)
    case E.KNOB_HOLD:
      return state.apEngaged ? disengage(state) : state
    case E.CWS_TAP:
      return state.apEngaged ? disengage(state) : state // a tap disengages (§5.2.2)
    case E.CWS_PRESS:
      return state.apEngaged ? { ...state, cwsHeld: true } : state
    case E.CWS_RELEASE:
      return onCwsRelease(state)
    case E.AP_LVL:
      return emergencyLevel(state)
    default:
      return state
  }
}

// ---- config & power ----

function applyConfig(state, patch) {
  const { type, ...fields } = patch
  // Power transitions
  if ('power' in fields) {
    if (fields.power === 'on' && state.power === 'off') {
      return { ...state, ...fields, power: 'booting', bootTimer: 3, warning: null }
    }
    if (fields.power === 'off') {
      // full power-down: clears warnings & baro resets on next boot (§3, §8.4)
      return { ...initialState, ...keepConfig(state), ...fields, power: 'off' }
    }
  }
  let s = { ...state, ...fields }
  // Starting the RNAV scenario snaps the aircraft to the chosen IAF.
  if (fields.scenarioActive === true) {
    s = startScenario(s, fields.scenarioIaf || s.scenarioIaf)
  } else if (fields.scenarioActive === false) {
    s = { ...s, gpsDtk: null }
  }
  // Inducing a sensor error disengages and latches until power cycle (§8.4)
  if (fields.warning === 'SENSOR') {
    s = { ...s, apEngaged: false, verticalMode: null, screen: 'NORMAL' }
  }
  // Induced bank only meaningful while disengaged (AEP demo, §8.2)
  if ('inducedBank' in fields && !s.apEngaged) {
    s.bankAngle = fields.inducedBank
  }
  return s
}

function keepConfig(s) {
  return {
    contrast: s.contrast,
    minBklt: s.minBklt,
    gpsStatus: s.gpsStatus,
    gpsData: s.gpsData,
    arinc: s.arinc,
    groundSpeed: s.groundSpeed,
    approachActive: s.approachActive,
    glideslopeFlagged: s.glideslopeFlagged,
    curTrack: s.curTrack,
    curAlt: s.curAlt,
    skyview: s.skyview,
    skyviewCdi: s.skyviewCdi,
    svHeadingBug: s.svHeadingBug,
    svAltBug: s.svAltBug,
    svAltBugSet: s.svAltBugSet,
    svVsBug: s.svVsBug,
    scenarioActive: s.scenarioActive,
    scenarioIaf: s.scenarioIaf,
    curX: s.curX,
    curY: s.curY,
    activeLeg: s.activeLeg,
  }
}

// Position the aircraft at the chosen IAF to begin the RNAV (GPS) RWY 10
// scenario: snap to the fix, head down the first leg toward UBAYA, arriving at
// 3000 ft so the pilot can set up the descent to the 2300 ft platform.
function startScenario(s, iaf) {
  const plan = PLANS[iaf]
  if (!plan) return { ...s, scenarioActive: false, scenarioIaf: null }
  const p0 = FIX_XY[iaf]
  const crsMag = Math.round(trueToMag(bearingToTrue(plan[0], plan[1])))
  return {
    ...s,
    scenarioActive: true,
    scenarioIaf: iaf,
    approachActive: true,
    skyviewCdi: 'flightplan', // show the GPS course needle & glideslope on the PFD
    curX: p0.x,
    curY: p0.y,
    curTrack: crsMag,
    selTrack: crsMag,
    svHeadingBug: crsMag,
    gpsDtk: crsMag,
    curAlt: 3000,
    curVS: 0,
    activeLeg: 1,
    agl: 3000 - FIELD_ELEV,
  }
}

// ---- MODE ----

function onMode(s) {
  // MODE exits any setup/sync screen back to normal (§5.1 note).
  if (s.screen !== 'NORMAL') return { ...s, screen: 'NORMAL', cursor: 'track' }

  // With a SkyView connected, MODE toggles SkyView mode (Install Manual §10.2).
  if (s.skyview === 'on') {
    return s.lateralMode === 'SKYVIEW' ? exitSkyview(s) : enterSkyview(s)
  }

  if (!s.apEngaged) {
    // Disengaged: MODE toggles AEP arming (§8.2, §9).
    if (s.aep === 'off') return { ...s, aep: 'stby' }
    return { ...s, aep: 'off' }
  }

  // Engaged: cycle the available lateral modes.
  const cycle = lateralCycle(s)
  const i = cycle.indexOf(s.lateralMode)
  const next = cycle[(i + 1) % cycle.length]
  return { ...s, lateralMode: next }
}

// ---- SkyView mode (Installation Manual §10) ----

// Entering grabs the current heading/altitude/VS bugs from the SkyView. With a
// flight plan on the SkyView CDI the lateral source is GPS; otherwise it follows
// the heading bug. Vertical follows the VS bug, or transitions to the altitude
// bug when one is set (capturing into ALT HOLD).
function enterSkyview(s) {
  const climbing = s.svAltBugSet && Math.abs(s.svAltBug - s.curAlt) >= 50
  return {
    ...s,
    lateralMode: 'SKYVIEW',
    verticalMode: climbing ? 'SEL' : 'SVS',
    selTrack: mod360(s.svHeadingBug),
    selAlt: s.svAltBug,
    selVS: s.svVsBug,
    cursor: 'track',
    aep: 'off',
  }
}

// Exiting synchronizes to the current track and vertical speed (§10.2 step 5).
function exitSkyview(s) {
  return {
    ...s,
    lateralMode: 'TRK',
    verticalMode: s.apEngaged ? 'SVS' : null,
    selTrack: mod360(round(s.curTrack, 1)),
    selVS: round(s.curVS, 100),
    cursor: 'track',
  }
}

// ---- ALT ----

function onAlt(s) {
  if (!s.apEngaged) {
    if (s.screen === 'NORMAL') {
      // Altitude pre-select setup (§5.4.4).
      return { ...s, screen: 'SEL_ALT', cursor: 'altSel', altTouched: false }
    }
    if (s.screen === 'SEL_ALT') return { ...s, screen: 'ALT_SYNC', cursor: 'baro' }
    if (s.screen === 'ALT_SYNC') return { ...s, screen: 'NORMAL', cursor: 'altSel' }
    return s
  }

  // Engaged
  if (s.screen === 'SEL_ALT') return { ...s, screen: 'ALT_SYNC', cursor: 'baro' }
  if (s.screen === 'ALT_SYNC') return { ...s, screen: 'NORMAL', cursor: 'track' }
  if (s.screen !== 'NORMAL') return s

  // Engaged on the normal screen
  if (s.verticalMode === 'GS_CPLD') {
    // Missed approach: break off and climb at 500 fpm, staying in GPSS (§5.4.6).
    return { ...s, verticalMode: 'SVS', selVS: 500, gsTimer: 0 }
  }
  // Enter altitude-select setup (§5.4.3).
  return { ...s, screen: 'SEL_ALT', cursor: 'altSel', altTouched: false }
}

// ---- KNOB rotate ----

function rotate(s, dir, fine) {
  switch (s.screen) {
    case 'CONTRAST':
      return { ...s, contrast: clamp(s.contrast + dir, 0, 9) }
    case 'MIN_BKLT':
      return { ...s, minBklt: clamp(s.minBklt + dir, 0, 9) }
    case 'GYRO_TRIM':
      return { ...s, gyroTrim: round(s.gyroTrim + dir * 0.2, 0.2) }
    case 'ALT_SYNC':
      return { ...s, baro: clamp(s.baro + dir * (fine ? 1 : 10), -1000, 99000) }
    case 'SEL_ALT':
      if (s.cursor === 'vs') return { ...s, selVS: s.selVS + dir * 100 }
      return { ...s, selAlt: clamp(s.selAlt + dir * (fine ? 100 : 500), 0, 99000), altTouched: true }
    case 'NORMAL':
    default:
      // In SkyView mode all commands come from the SkyView, not the knob (§10.2).
      if (s.lateralMode === 'SKYVIEW') return s
      if (!s.apEngaged) return s // track select only works engaged
      // Gyro backup: knob selects bank angle (or SVS when the cursor is on it),
      // press+rotate (fine) opens the trim screen (§8.3).
      if (isGyro(s)) {
        if (s.cursor === 'vs') return { ...s, selVS: s.selVS + dir * 100, verticalMode: 'SVS' }
        if (fine) return { ...s, screen: 'GYRO_TRIM', cursor: 'gyroTrim' }
        return { ...s, selBank: clamp(s.selBank + dir * 1, -30, 30) }
      }
      if (s.cursor === 'vs') {
        return { ...s, selVS: s.selVS + dir * 100, verticalMode: 'SVS' }
      }
      if (s.cursor === 'altSel' && s.verticalMode === 'SEL') {
        return { ...s, selAlt: clamp(s.selAlt + dir * (fine ? 100 : 500), 0, 99000) }
      }
      // default: select track
      return { ...s, selTrack: mod360(s.selTrack + dir * (fine ? 1 : 5)) }
  }
}

// ---- KNOB press ----

function onKnobPress(s) {
  switch (s.screen) {
    case 'CONTRAST':
      return { ...s, screen: 'MIN_BKLT', cursor: 'minBklt' }
    case 'MIN_BKLT':
      return { ...s, screen: 'SETUP', cursor: 'track' }
    case 'SETUP':
      return { ...s, screen: 'NORMAL', cursor: 'track' }
    case 'GYRO_TRIM':
      return { ...s, screen: 'NORMAL', cursor: 'track' }
    case 'ALT_SYNC':
      // confirm the baro value and return (§5.1)
      return { ...s, screen: 'NORMAL', cursor: s.apEngaged ? 'track' : 'altSel' }
    case 'SEL_ALT':
      if (!s.apEngaged) {
        // §5.4.4 / Fig 5.4.4a: pressing the KNOB from the pre-select screen
        // engages the AP, which then proceeds in a climb/descent toward the
        // selected altitude (synchronizing to the current vertical speed).
        return engage({ ...s, preselectArmed: true })
      }
      if (s.cursor === 'altSel') {
        // §5.4.2: pressing the KNOB without changing the altitude captures the
        // current altitude into ALT HOLD (nearest 100 ft). Rotating first puts
        // the cursor on SEL VS to set up a climb/descent instead (§5.4.3).
        if (!s.altTouched) {
          return { ...s, screen: 'NORMAL', verticalMode: 'ALTHOLD', selAlt: round(s.curAlt, 100), curVS: 0, cursor: 'track' }
        }
        return { ...s, cursor: 'vs' }
      }
      // confirm: begin the transition to the selected altitude (§5.4.3)
      return confirmAltSelect(s)
    case 'NORMAL':
    default:
      if (!s.apEngaged) return engage(s)
      // engaged: a press in ALT HOLD returns to SVS-zero (§5.4.1)
      if (s.verticalMode === 'ALTHOLD') {
        return { ...s, verticalMode: 'SVS', selVS: 0, cursor: 'track' }
      }
      // otherwise advance the editing cursor (§5.4.3)
      return { ...s, cursor: nextCursor(s) }
  }
}

function nextCursor(s) {
  const order = s.verticalMode === 'SEL' ? ['track', 'vs', 'altSel'] : ['track', 'vs']
  const i = order.indexOf(s.cursor)
  return order[(i + 1) % order.length]
}

function confirmAltSelect(s) {
  // If the selected altitude is essentially the current altitude, go straight to
  // ALT HOLD; otherwise start the transition in SEL mode (§5.4.3).
  if (Math.abs(s.selAlt - s.curAlt) < 50) {
    return { ...s, screen: 'NORMAL', verticalMode: 'ALTHOLD', cursor: 'track' }
  }
  const synced = Math.abs(s.selVS) >= 400 ? round(s.selVS, 100) : 500
  return { ...s, screen: 'NORMAL', verticalMode: 'SEL', selVS: synced, cursor: 'track' }
}

// ---- engage / disengage ----

function engage(s) {
  // Engaging while already in SkyView mode (entered from AP OFF) stays in SkyView
  // and keeps following the SkyView bugs (Install Manual §10.2).
  if (s.skyview === 'on' && s.lateralMode === 'SKYVIEW') {
    return { ...enterSkyview(s), apEngaged: true, preselectArmed: false }
  }
  const lateral = lateralCycle(s).includes(s.lateralMode) ? s.lateralMode : 'TRK'
  let verticalMode = 'SVS'
  let selVS = round(s.curVS, 100)
  if (s.preselectArmed && Math.abs(s.selAlt - s.curAlt) >= 50) {
    verticalMode = 'SEL'
    selVS = Math.abs(s.curVS) >= 400 ? round(s.curVS, 100) : 500 // §5.4.4
  }
  return {
    ...s,
    apEngaged: true,
    screen: 'NORMAL',
    lateralMode: lateral,
    verticalMode,
    selTrack: mod360(round(s.curTrack, 1)),
    selVS,
    preselectArmed: false,
    cursor: 'track',
    emergencyLevel: false,
    aep: 'off',
  }
}

function disengage(s) {
  return {
    ...s,
    apEngaged: false,
    verticalMode: null,
    emergencyLevel: false,
    cwsHeld: false,
    screen: 'NORMAL',
    cursor: 'track',
    aep: 'stby', // AEP returns to standby monitoring when AP drops (§8.2)
  }
}

function onCwsRelease(s) {
  if (!s.cwsHeld) return s
  // Resume holding the new track and VS at release (§5.4.7).
  const selVS = Math.abs(s.curVS) >= 400 ? round(s.curVS, 100) : 0
  return { ...s, cwsHeld: false, selTrack: mod360(round(s.curTrack, 1)), selVS }
}

function emergencyLevel(s) {
  // Engage to wings-level, zero VS from any attitude (§8.1).
  return {
    ...s,
    apEngaged: true,
    emergencyLevel: true,
    screen: 'NORMAL',
    verticalMode: 'SVS',
    selVS: 0,
    selTrack: mod360(round(s.curTrack, 1)),
    selBank: 0,
    cursor: 'track',
    emergencyTimer: 15,
    aep: 'off',
  }
}

// ---- tick: timers, flight model, auto-transitions ----

function onTick(s, dt) {
  if (s.power === 'booting') {
    const t = s.bootTimer - dt
    if (t <= 0) return { ...s, power: 'on', bootTimer: 0, screen: 'NORMAL' }
    return { ...s, bootTimer: t }
  }
  if (s.power !== 'on') return s

  // The position-based scenario engine takes over when active; otherwise the
  // legacy light flight model runs.
  let next = { ...s, ...(s.scenarioActive ? stepScenario(s, dt) : stepFlight(s, dt)) }

  // gyro-backup derived flag
  next.gyroMode = isGyro(next)

  // SkyView mode: track/altitude/VS are slaved to the SkyView bugs (§10.2).
  if (next.lateralMode === 'SKYVIEW') {
    if (next.skyview !== 'on') {
      next = exitSkyview(next) // signal lost -> drop out
    } else {
      next = { ...next, selTrack: mod360(next.svHeadingBug), selVS: next.svVsBug, selAlt: next.svAltBug }
      if (!next.svAltBugSet) {
        next.verticalMode = 'SVS' // no alt bug -> follow the VS bug
      } else if (next.verticalMode !== 'SEL' && next.verticalMode !== 'ALTHOLD') {
        next.verticalMode = Math.abs(next.svAltBug - next.curAlt) >= 50 ? 'SEL' : 'ALTHOLD'
      } else if (next.verticalMode === 'ALTHOLD' && Math.abs(next.svAltBug - next.curAlt) >= 50) {
        next.verticalMode = 'SEL' // alt bug moved -> resume the transition
      }
    }
  }

  // Emergency level reverts to TRK after ~15s (§8.1)
  if (next.emergencyLevel) {
    const t = next.emergencyTimer - dt
    if (t <= 0) {
      next = { ...next, emergencyLevel: false, emergencyTimer: 0, lateralMode: 'TRK', selTrack: mod360(round(next.curTrack, 1)) }
    } else {
      next.emergencyTimer = t
    }
  }

  // Altitude capture: SEL transition reaching target -> ALT HOLD (§5.4.3, §9)
  if (next.apEngaged && next.verticalMode === 'SEL' && Math.abs(next.selAlt - next.curAlt) < 30) {
    next = { ...next, verticalMode: 'ALTHOLD', curVS: 0, curAlt: next.selAlt }
  }

  // Vertical approach sequencing (§5.4.5). In the scenario, coupling is driven
  // by position (at ZIMBO) inside the engine, so skip the timer-based arming.
  const gsEligible =
    !next.scenarioActive &&
    next.apEngaged &&
    next.lateralMode === 'GPSS' &&
    next.approachActive &&
    ((next.verticalMode === 'SVS' && next.selVS === 0) || next.verticalMode === 'ALTHOLD')
  if (gsEligible && next.verticalMode !== 'GS_ARM' && !next.verticalMode.startsWith?.('GS_')) {
    next = { ...next, verticalMode: next.glideslopeFlagged ? 'GS_FLG' : 'GS_ARM', gsTimer: 4 }
  } else if (next.verticalMode === 'GS_ARM') {
    const t = next.gsTimer - dt
    if (t <= 0) next = { ...next, verticalMode: 'GS_CPLD', gsTimer: 0 }
    else next.gsTimer = t
  }
  if (next.verticalMode && next.verticalMode.startsWith('GS_') && !next.approachActive) {
    next = { ...next, verticalMode: 'ALTHOLD' }
  }

  // AEP active/standby based on bank while disengaged (§8.2)
  if (!next.apEngaged && next.aep !== 'off') {
    if (Math.abs(next.bankAngle) > 40) next.aep = 'active'
    else if (next.aep === 'active') next.aep = 'stby'
  }

  return next
}

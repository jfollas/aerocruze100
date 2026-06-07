// The autopilot state machine — a pure reducer faithful to the TT-167 Vizion PMA
// Operating Handbook (the Aerocruze 100 is the rebranded unit). reducer(state, event)
// returns the next state. All section references (§) point at that handbook.

import * as E from './events.js'
import { stepFlight, mod360, MIN_IAS } from './flight.js'
import { stepScenario } from './scenario.js'
import { FIELD_ELEV, bearingToTrue, trueToMag } from './geo.js'
import { PLANS, PLAN_ENTRY } from './navplan.js'

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x))
const round = (x, step) => Math.round(x / step) * step

// The autopilot derives altitude from its own (uncorrected) pressure source, so
// its reading can differ from the PFD's baro-corrected altitude by an offset the
// pilot must zero on the ALT SYNC screen (press ALT twice, then match). Aspen
// (PMAEFIS Type 1) and Garmin G5 (Type 2) feed the baro-corrected altitude over
// ARINC, so they keep the autopilot synced automatically.
const STARTUP_BARO_DELTA = 200 // mismatch present at power-up (startup checklist)
const PREAPP_BARO_DELTA = 150 // re-introduced when arming GPSS for an approach (pre-procedure check)

// True when the connected EFIS feeds the autopilot a digital baro-corrected
// altitude over ARINC, keeping it auto-synced (no mismatch): Aspen and G5 only.
// The SkyView cannot do this, so it still needs a manual ALT SYNC (a downside).
function baroAutoSync(s) {
  return s.arinc === 'aspen' || s.arinc === 'g5'
}

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
  altDelta: 0, // autopilot reported altitude minus the PFD altitude (ft); zeroed by ALT SYNC
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
  groundSpeed: 0, // commanded true airspeed (kt); ground speed is derived from it + wind
  curGS: 0, // actual ground speed (kt) = airspeed +/- wind
  curGT: 0, // actual ground track (°mag) — heading drifted by the wind
  windDir: 270, // gradient (aloft) wind FROM direction, °magnetic
  windSpd: 0, // gradient (aloft) wind speed, kt (0-45); backs & slows toward the surface
  windNow: { fromMag: 270, speed: 0 }, // wind at the current altitude (derived each tick)

  // config (set via SET_CONFIG)
  gpsStatus: 'OK', // NOGPS | NOFIX | OK
  gpsData: 'none', // none | portable (RS232 -> GPS NAV) | ifr (ARINC429 -> GPSS)
  arinc: 'none', // none | aspen (A) | g5 (E)
  approachActive: false,
  glideslopeFlagged: false,
  lpvPhase: null, // LPV approach phase: null | TURN | ARM | CPLD
  gsDist: null, // NM to the threshold while on the LPV approach
  gsDev: 0, // glideslope deviation in dots (+ = beam above, fly up); for the GSI
  gpsDtk: null, // desired track of the active GPS leg (deg mag); drives the HSI needle
  cdiDev: 0, // lateral course deviation in dots (+ = course right of aircraft)
  cdiScale: null, // CDI full-scale sensitivity (NM)
  cdiAngular: false, // CDI scaling is angular (LPV final) rather than linear NM
  cdiToFrom: null, // CDI TO/FROM flag: 'TO' | 'FROM' | null

  // RNAV (GPS) RWY 10 scenario (to-scale map + profile). When active, the
  // position-based scenario engine flies the published approach.
  scenarioActive: false,
  scenarioIaf: null, // chosen entry: LEYIR | WUDAT | UBAYA_DIRECT | UBAYA_TEARDROP | UBAYA_PARALLEL
  hilptEntry: null, // UBAYA hold-in-lieu entry: DIRECT | TEARDROP | PARALLEL | null
  curX: 0, // aircraft position east of the field (nm)
  curY: 0, // aircraft position north of the field (nm)
  activeLeg: 0, // index of the active leg in PLANS[scenarioIaf]
  agl: undefined, // height above field (ft); drives the 700-AGL warning
  inducedBank: 0, // for AEP demonstration while disengaged
  inducedClimb: false, // held nose-up (bleeds airspeed) for the AEP low-speed demo
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
      // full power-down: clears warnings & the baro mismatch is re-set on next boot (§3, §8.4)
      return { ...initialState, ...keepConfig(state), ...fields, power: 'off' }
    }
  }
  let s = { ...state, ...fields }
  // Starting the RNAV scenario snaps the aircraft to the chosen IAF.
  if (fields.scenarioActive === true) {
    s = startScenario(s, fields.scenarioIaf || s.scenarioIaf)
  } else if (fields.scenarioActive === false) {
    s = { ...s, approachActive: false, gpsDtk: null, cdiDev: 0, cdiScale: null, cdiAngular: false, cdiToFrom: null, hilptEntry: null }
  }
  // Inducing a sensor error disengages and latches until power cycle (§8.4)
  if (fields.warning === 'SENSOR') {
    s = { ...s, apEngaged: false, verticalMode: null, screen: 'NORMAL' }
  }
  // inducedBank (AEP demo, §8.2) is a *target*: the flight model eases the actual
  // bank toward it (a gradual roll-off) rather than snapping, so the upset builds.
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
    windDir: s.windDir,
    windSpd: s.windSpd,
    approachActive: s.approachActive,
    glideslopeFlagged: s.glideslopeFlagged,
    // the aircraft (PFD) state persists across an autopilot power cycle
    curTrack: s.curTrack,
    curAlt: s.curAlt,
    curIAS: s.curIAS,
    curVS: s.curVS,
    pitch: s.pitch,
    bankAngle: s.bankAngle,
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
  const p0 = plan[0] // first waypoint (a fix, or a synthetic HILPT start)
  const crsMag = Math.round(trueToMag(bearingToTrue(plan[0], plan[1])))
  return {
    ...s,
    scenarioActive: true,
    scenarioIaf: iaf,
    hilptEntry: PLAN_ENTRY[iaf] || null, // 'DIRECT' | 'TEARDROP' | 'PARALLEL' | null
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
  const out = { ...s, lateralMode: next }
  // Arming GPSS for a loaded approach re-introduces a baro mismatch, prompting
  // an altitude check/sync as part of the pre-procedure checklist.
  if (next === 'GPSS' && s.approachActive && !baroAutoSync(s)) {
    out.altDelta = PREAPP_BARO_DELTA
  }
  return out
}

// ---- SkyView mode (Installation Manual §10) ----

// Entering grabs the current heading/altitude/VS bugs from the SkyView. With a
// flight plan on the SkyView CDI the lateral source is GPS; otherwise it follows
// the heading bug. Vertical follows the VS bug, or transitions to the altitude
// bug when one is set (capturing into ALT HOLD).
function enterSkyview(s) {
  const climbing = s.svAltBugSet && Math.abs(s.svAltBug - (s.curAlt + s.altDelta)) >= 50
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
      // match the reported altitude to the PFD: adjust the offset toward zero
      return { ...s, altDelta: clamp(s.altDelta + dir * (fine ? 1 : 10), -2000, 2000) }
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
          // capture the autopilot's current altimeter reading (curAlt + altDelta)
          return { ...s, screen: 'NORMAL', verticalMode: 'ALTHOLD', selAlt: round(s.curAlt + s.altDelta, 100), curVS: 0, cursor: 'track' }
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
  // Comparisons are against the autopilot's altimeter reading (curAlt + altDelta).
  const apAlt = s.curAlt + s.altDelta
  // If the selected altitude is essentially the current altitude, go straight to
  // ALT HOLD; otherwise start the transition in SEL mode (§5.4.3).
  if (Math.abs(s.selAlt - apAlt) < 50) {
    return { ...s, screen: 'NORMAL', verticalMode: 'ALTHOLD', cursor: 'track' }
  }
  // SEL VS direction always follows the altitude change (descend = down); the
  // magnitude is the entered rate, or 500 fpm if too shallow / unset (§5.4.4).
  const mag = Math.abs(s.selVS) >= 400 ? Math.abs(round(s.selVS, 100)) : 500
  const synced = (s.selAlt < apAlt ? -1 : 1) * mag
  return { ...s, screen: 'NORMAL', verticalMode: 'SEL', selVS: synced, cursor: 'track' }
}

// ---- engage / disengage ----

function engage(s) {
  // With a SkyView as the nav source, engaging follows the SkyView bugs (there is
  // no reason to engage into plain TRK), so the autopilot immediately flies the
  // HDG/ALT/VS bugs (Install Manual §10.2).
  if (s.skyview === 'on') {
    return { ...enterSkyview(s), apEngaged: true, preselectArmed: false }
  }
  const lateral = lateralCycle(s).includes(s.lateralMode) ? s.lateralMode : 'TRK'
  let verticalMode = 'SVS'
  let selVS = round(s.curVS, 100)
  if (s.preselectArmed && Math.abs(s.selAlt - (s.curAlt + s.altDelta)) >= 50) {
    verticalMode = 'SEL'
    // §5.4.4: sync to the current VS, defaulting to 500 fpm, but always in the
    // direction of the selected altitude (descend = down) per the AP's altimeter.
    const mag = Math.abs(s.curVS) >= 400 ? Math.abs(round(s.curVS, 100)) : 500
    selVS = (s.selAlt < s.curAlt + s.altDelta ? -1 : 1) * mag
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
  // Autopilot boot countdown (its LCD comes alive after ~3 s).
  if (s.power === 'booting') {
    const t = s.bootTimer - dt
    if (t <= 0) {
      // come alive with a baro mismatch to sync on the startup checklist (unless
      // the EFIS keeps it synced for us)
      const altDelta = baroAutoSync(s) ? 0 : STARTUP_BARO_DELTA
      s = { ...s, power: 'on', bootTimer: 0, screen: 'NORMAL', altDelta }
    } else {
      s = { ...s, bootTimer: t }
    }
  }

  // The aircraft and its PFD are always live: the flight model runs regardless
  // of the autopilot's power state (with the AP off it simply coasts). The
  // position-based scenario engine takes over when active.
  let next = { ...s, ...(s.scenarioActive ? stepScenario(s, dt) : stepFlight(s, dt)) }

  // gyro-backup derived flag
  next.gyroMode = isGyro(next)

  // Autopilot logic below only runs when the autopilot is powered on.
  if (next.power !== 'on') return next

  // EFIS that feed the baro-corrected altitude keep the autopilot auto-synced.
  if (baroAutoSync(next)) next.altDelta = 0

  // SkyView mode: track/altitude/VS are slaved to the SkyView bugs (§10.2).
  if (next.lateralMode === 'SKYVIEW') {
    if (next.skyview !== 'on') {
      next = exitSkyview(next) // signal lost -> drop out
    } else {
      // Through the SkyView the autopilot follows the bugs vertically (the GPS
      // glideslope is not coupled), managing altitude with the ALT/VS bugs.
      next = { ...next, selTrack: mod360(next.svHeadingBug), selVS: next.svVsBug, selAlt: next.svAltBug }
      const apAlt = next.curAlt + next.altDelta // the autopilot's altimeter reading
      if (!next.svAltBugSet) {
        next.verticalMode = 'SVS' // no alt bug -> follow the VS bug
      } else if (next.verticalMode !== 'SEL' && next.verticalMode !== 'ALTHOLD') {
        next.verticalMode = Math.abs(next.svAltBug - apAlt) >= 50 ? 'SEL' : 'ALTHOLD'
      } else if (next.verticalMode === 'ALTHOLD' && Math.abs(next.svAltBug - apAlt) >= 50) {
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

  // Altitude capture: SEL transition reaching target -> ALT HOLD (§5.4.3, §9).
  // The AP captures when ITS altimeter (curAlt + altDelta) reaches selAlt, so the
  // actual/PFD altitude settles at selAlt - altDelta (offset until ALT SYNC'd).
  if (next.apEngaged && next.verticalMode === 'SEL' && Math.abs(next.selAlt - (next.curAlt + next.altDelta)) < 30) {
    next = { ...next, verticalMode: 'ALTHOLD', curVS: 0, curAlt: next.selAlt - next.altDelta }
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

  // AEP bank protection while disengaged (§8.2): trips ACTIVE above the 40° bank
  // limit (the roll servo then nudges it back toward a safe angle), and clears to
  // STBY once the bank is back inside the limit.
  if (!next.apEngaged && next.aep !== 'off') {
    if (Math.abs(next.bankAngle) > 40) next.aep = 'active'
    else if (next.aep === 'active' && Math.abs(next.bankAngle) < 34) next.aep = 'stby'
  }

  // Min-airspeed protection while engaged (§8.5): annunciate MIN AS and have the
  // AP hold the minimum (the flight model lowers the nose). Gated to the induced
  // nose-up demo so it doesn't clobber the manual Induce-Conditions airspeed flag.
  if (next.apEngaged && next.inducedClimb) {
    if (next.curIAS <= MIN_IAS && next.warning !== 'SENSOR') next.warning = 'MIN_AS'
    else if (next.warning === 'MIN_AS' && next.curIAS >= MIN_IAS + 10) next.warning = null
  }

  return next
}

// Light flight model. Pure function: given the current state and a timestep (s),
// returns a partial patch of the *actual* aircraft values (curTrack, curAlt, curVS,
// bankAngle). Selected/target values are user-driven and never changed here.

export const TURN_RATE = 6 // deg/sec of heading change at full bank
export const MAX_BANK = 25 // deg, the autopilot's commanded bank limit
export const ROLL_RESPONSE = 1.5 // how quickly bank settles toward its target (1/sec)
export const VS_RESPONSE = 4 // how quickly actual VS chases target VS (1/sec)
export const CRUISE_IAS = 110 // nominal cruise indicated airspeed (kt)
const IAS_RESPONSE = 0.6 // how quickly IAS settles toward its target (1/sec)
const PITCH_RESPONSE = 2 // how quickly pitch settles toward its target (1/sec)
// Commanded fpm per foot of remaining altitude error. At 10 fpm/ft the easing
// leads the target by 10% of the vertical speed (e.g. 50 ft at 500 fpm).
export const ALT_CAPTURE_GAIN = 10

// LPV approach (vertical guidance shown right of the HSI when on a GPS LPV
// approach). Scripted by distance to the threshold: turn to intercept the
// course, capture the final approach at 7 NM with the glideslope one dot high,
// fly it down to centred at 5 NM, then couple and descend at 90 kt / -500 fpm.
const GS_START_ALT = 3000 // ft, altitude when the approach is activated
const GS_PLATFORM_ALT = 2500 // ft, preselected level-off / glideslope intercept altitude
const GS_PRE_VS = -750 // fpm descent from the start altitude down to the platform
const GS_APPROACH_IAS = 90 // kt flown on the approach
const GS_DESCENT = -500 // fpm tracked down the glidepath once coupled
const GS_ARM_NM = 7 // NM out where the final approach course is intercepted
const GS_CPLD_NM = 5 // NM out where the glideslope centres and couples

// Signed shortest angular difference a->b in (-180,180]
export function angleDiff(a, b) {
  let d = ((b - a + 540) % 360) - 180
  return d
}
export const mod360 = (x) => ((x % 360) + 360) % 360
export const approach = (cur, target, maxStep) => {
  const d = target - cur
  if (Math.abs(d) <= maxStep) return target
  return cur + Math.sign(d) * maxStep
}

// Shared bank/turn integrator: ease the bank toward the commanded track and
// advance curTrack in proportion to the actual bank (a coordinated turn). Used
// by both the legacy stepFlight path and the position-based scenario engine.
export function lateralStep(s, dt, targetTrackMag, maxBank = MAX_BANK) {
  const d = angleDiff(s.curTrack, targetTrackMag)
  const targetBank = Math.max(-maxBank, Math.min(maxBank, d))
  const bank = approach(s.bankAngle, targetBank, Math.abs(targetBank - s.bankAngle) * Math.min(1, ROLL_RESPONSE * dt))
  const turnStep = (bank / MAX_BANK) * TURN_RATE * dt
  const curTrack = mod360(s.curTrack + Math.sign(d) * Math.min(Math.abs(d), Math.abs(turnStep)))
  return { bankAngle: bank, curTrack, d }
}

// Shared airspeed + pitch tail: ease IAS toward target and pitch toward the
// value implied by the vertical speed.
export function perfStep(s, dt, newVS, targetIAS) {
  const curIAS = approach(s.curIAS, targetIAS, Math.abs(targetIAS - s.curIAS) * Math.min(1, IAS_RESPONSE * dt))
  const targetPitch = Math.max(-12, Math.min(12, newVS * 0.012))
  const pitch = approach(s.pitch, targetPitch, Math.abs(targetPitch - s.pitch) * Math.min(1, PITCH_RESPONSE * dt))
  return { curIAS, pitch }
}

// Engaged, non-approach vertical target VS for the AP's current vertical mode
// (SEL / ALT HOLD / SVS / coupled-GS); disengaged simply coasts. Shared so the
// scenario engine matches the legacy model exactly.
export function userVerticalTargetVS(s) {
  if (!s.apEngaged) return s.curVS
  if (s.verticalMode === 'SEL') {
    const altErr = s.selAlt - s.curAlt
    const cap = Math.abs(s.selVS || 500)
    return Math.max(-cap, Math.min(cap, altErr * ALT_CAPTURE_GAIN))
  }
  if (s.verticalMode === 'GS_CPLD') return -500
  if (s.verticalMode === 'ALTHOLD' || s.verticalMode === 'GS_ARM' || s.verticalMode === 'GS_FLG') return 0
  return s.selVS // SVS
}

export function stepFlight(s, dt) {
  if (s.power === 'off' && s.groundSpeed <= 10) return {} // parked & unpowered: nothing to integrate
  const patch = {}
  // the scripted LPV demo only flies the aircraft while the AP is engaged
  const onLpv = s.apEngaged && s.approachActive && s.skyviewCdi === 'flightplan'

  // ---- LPV phase bookkeeping ----
  // TURN: turning to intercept -> ARM: established, glideslope falling toward
  // centre -> CPLD: glideslope centred, descending. Entering the approach snaps
  // us level at the intercept altitude.
  let lpvPhase = onLpv ? s.lpvPhase || 'TURN' : null
  let gsDist = onLpv ? s.gsDist : null
  const altBase = onLpv && !s.lpvPhase ? GS_START_ALT : s.curAlt

  // ---- Lateral ----
  if (onLpv) {
    // Turn to the heading the magenta GPS needle points to (the heading bug).
    const { bankAngle, curTrack, d } = lateralStep(s, dt, mod360(s.svHeadingBug))
    patch.bankAngle = bankAngle
    patch.curTrack = curTrack
    // established once we've rolled out on the intercept heading -> arm the GS
    if (lpvPhase === 'TURN' && Math.abs(d) < 1 && Math.abs(bankAngle) < 1) {
      lpvPhase = 'ARM'
      gsDist = GS_ARM_NM
    }
  } else if (s.apEngaged && !s.emergencyLevel && !s.gyroMode) {
    // Eased, coordinated turn toward the selected track.
    const { bankAngle, curTrack } = lateralStep(s, dt, s.selTrack)
    patch.bankAngle = bankAngle
    patch.curTrack = curTrack
  } else if (s.apEngaged && s.emergencyLevel) {
    patch.bankAngle = approach(s.bankAngle, 0, 30 * dt)
    patch.curTrack = s.curTrack
  } else if (s.apEngaged && s.gyroMode) {
    // gyro backup: hold the selected bank angle (wing leveler at 0)
    patch.bankAngle = approach(s.bankAngle, s.selBank, 30 * dt)
    patch.curTrack = mod360(s.curTrack + (patch.bankAngle / 10) * dt)
  } else {
    // disengaged: bank follows induced value (for AEP demo), track drifts with bank
    patch.bankAngle = approach(s.bankAngle, s.inducedBank, 30 * dt)
    patch.curTrack = mod360(s.curTrack + (patch.bankAngle / 10) * dt)
  }

  // ---- Vertical ----
  let targetVS = 0
  if (onLpv) {
    // March inbound at 90 kt. The magenta glideslope falls from one dot above
    // centre (7 NM) to centred at 5 NM, where it couples and we start down.
    if (gsDist != null) gsDist = Math.max(0, gsDist - (GS_APPROACH_IAS / 3600) * dt)
    if (lpvPhase === 'ARM' && gsDist <= GS_CPLD_NM) lpvPhase = 'CPLD'
    // deviation in dots: +1 at the arm point, easing to 0 at the couple point
    const dev = lpvPhase === 'ARM' ? Math.max(0, Math.min(1, (gsDist - GS_CPLD_NM) / (GS_ARM_NM - GS_CPLD_NM))) : 0
    if (lpvPhase === 'CPLD') {
      targetVS = GS_DESCENT // coupled — track the glidepath down at -500 fpm
    } else {
      // descend from the start altitude to the preselected platform at -750 fpm,
      // easing into the level-off, then hold it until the glideslope couples
      const altErr = GS_PLATFORM_ALT - s.curAlt
      targetVS = Math.max(GS_PRE_VS, Math.min(-GS_PRE_VS, altErr * ALT_CAPTURE_GAIN))
    }
    patch.lpvPhase = lpvPhase
    patch.gsDist = gsDist
    patch.gsDev = dev
  } else {
    // not on an LPV approach — clear the approach state so it re-arms next time
    patch.lpvPhase = null
    patch.gsDist = null
    patch.gsDev = 0
    targetVS = userVerticalTargetVS(s)
  }
  const newVS = approach(s.curVS, targetVS, Math.abs(targetVS - s.curVS) * Math.min(1, VS_RESPONSE * dt))
  patch.curVS = newVS
  patch.curAlt = Math.max(0, altBase + (newVS / 60) * dt)

  // ---- Airspeed & pitch (light model for the PFD) ----
  // The indicated airspeed follows the simulated ground speed (set via the
  // speed-tape drag or the Ground speed control), eased.
  const targetIAS = Math.max(0, s.groundSpeed)
  const { curIAS, pitch } = perfStep(s, dt, newVS, targetIAS)
  patch.curIAS = curIAS
  patch.pitch = pitch

  return patch
}

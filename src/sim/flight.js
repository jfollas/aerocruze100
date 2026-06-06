// Light flight model. Pure function: given the current state and a timestep (s),
// returns a partial patch of the *actual* aircraft values (curTrack, curAlt, curVS,
// bankAngle). Selected/target values are user-driven and never changed here.

import { magToTrue, trueToMag, FIELD_ELEV, TDZE } from './geo.js'
import { windVector, windAt } from './wind.js'

export const TURN_RATE = 6 // deg/sec of heading change at full bank
export const MAX_BANK = 25 // deg, the autopilot's commanded bank limit
const ROLL_RESPONSE = 1.5 // how quickly bank settles toward its target (1/sec)
export const VS_RESPONSE = 4 // how quickly actual VS chases target VS (1/sec)
const IAS_RESPONSE = 0.6 // how quickly IAS settles toward its target (1/sec)
const PITCH_RESPONSE = 2 // how quickly pitch settles toward its target (1/sec)
// Commanded fpm per foot of remaining altitude error. At 10 fpm/ft the easing
// leads the target by 10% of the vertical speed (e.g. 50 ft at 500 fpm).
export const ALT_CAPTURE_GAIN = 10

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
    // the AP flies to selAlt on ITS altimeter (curAlt + altDelta); when its
    // reading reaches selAlt the actual/PFD altitude is offset by altDelta
    const altErr = s.selAlt - (s.curAlt + s.altDelta)
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

  // ---- Lateral ----
  if (s.apEngaged && !s.emergencyLevel && !s.gyroMode) {
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
  // The position-based scenario engine owns the LPV glidepath; this light model
  // just clears any GS state and follows the autopilot's current vertical mode.
  patch.lpvPhase = null
  patch.gsDist = null
  patch.gsDev = 0
  const targetVS = userVerticalTargetVS(s)
  const newVS = approach(s.curVS, targetVS, Math.abs(targetVS - s.curVS) * Math.min(1, VS_RESPONSE * dt))
  // Touchdown: clamp at the runway (TDZE) and bring the speed to zero.
  const rawAlt = s.curAlt + (newVS / 60) * dt
  const onGround = rawAlt <= TDZE
  patch.curAlt = onGround ? TDZE : rawAlt
  patch.curVS = onGround ? 0 : newVS
  if (onGround) patch.groundSpeed = 0

  // ---- Airspeed & pitch (light model for the PFD) ----
  // The indicated airspeed follows the simulated ground speed (set via the
  // speed-tape drag or the Ground speed control), eased.
  const targetIAS = onGround ? 0 : Math.max(0, s.groundSpeed)
  const { curIAS, pitch } = perfStep(s, dt, patch.curVS, targetIAS)
  patch.curIAS = curIAS
  patch.pitch = pitch

  // ---- Ground speed & wind readout (airspeed +/- the wind along the heading) ----
  const tas = onGround ? 0 : Math.max(0, s.groundSpeed)
  const wind = tas > 0 ? windVector(s.curAlt - FIELD_ELEV, s.windDir, s.windSpd) : { wx: 0, wy: 0 }
  const hdgr = (magToTrue(patch.curTrack) * Math.PI) / 180
  const gx = tas * Math.sin(hdgr) + wind.wx
  const gy = tas * Math.cos(hdgr) + wind.wy
  patch.curGS = Math.round(Math.hypot(gx, gy))
  patch.curGT = patch.curGS > 1 ? Math.round(trueToMag(mod360((Math.atan2(gx, gy) * 180) / Math.PI))) : patch.curTrack
  patch.windNow = windAt(s.curAlt - FIELD_ELEV, s.windDir, s.windSpd)

  return patch
}

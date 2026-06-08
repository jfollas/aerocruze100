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
// Hands-off & disengaged with a standing bank: the nose drops into a descending
// spiral whose rate (and airspeed) grow with bank angle.
const SPIRAL_VS_PER_DEG = 22 // fpm of descent per degree of bank
const DIVE_KT_PER_DEG = 0.8 // extra airspeed per degree of bank
const ROLLOFF_RATE = 8 // deg/sec, slow uncommanded roll-off when disengaged & hands-off
// Control-wheel steering (§5.4.7): while CWS is held the servos follow the pilot.
// We have no yoke in the sim, so model a steady hand-flown banked turn; on release
// the AP resumes holding the new track.
export const CWS_TURN_BANK = 20 // deg of the simulated hand-flown turn while CWS is held
// AEP bank protection (§8.2), active while DISENGAGED: at >40° it nudges the bank
// back toward a safe angle inside the limit — it does NOT roll fully level.
const AEP_ROLL_RATE = 25 // deg/sec the roll servo nudges the bank back
export const AEP_SAFE_BANK = 35 // deg AEP nudges toward and holds (just inside the 40° limit)
// Min-airspeed protection (§8.5), active while ENGAGED: a held nose-up bleeds the
// airspeed; at the minimum the AP lowers the nose slightly to hold it.
export const MIN_IAS = 60 // kt minimum indicated airspeed
const CLIMB_VS = 800 // fpm of a held (unsustainable) nose-up climb
const CLIMB_BLEED = 9 // kt/sec the airspeed bleeds while the nose-up is held
const MINAS_RECOVER_VS = 350 // fpm gentle nose-down the protection commands
const MINAS_BUILD = 12 // kt/sec the airspeed builds back as the nose drops
const STALL_FLOOR = 30 // kt floor while bleeding (the protection intervenes above this)

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
  if (s.apEngaged && s.cwsHeld) {
    // CWS held: the pilot is hand-flying — simulate a steady banked turn so the
    // track changes while held; the AP resumes on the new track at release.
    const bank = approach(s.bankAngle, CWS_TURN_BANK, Math.abs(CWS_TURN_BANK - s.bankAngle) * Math.min(1, ROLL_RESPONSE * dt))
    patch.bankAngle = bank
    patch.curTrack = mod360(s.curTrack + (bank / MAX_BANK) * TURN_RATE * dt)
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
    // disengaged. AEP (active) nudges the bank back toward a safe angle inside the
    // 40° limit — it does NOT roll fully level; otherwise the bank eases toward
    // the induced value (a slow roll-off) and the track drifts with the bank.
    if (s.aep === 'active') {
      const safe = Math.sign(s.bankAngle || 1) * AEP_SAFE_BANK
      patch.bankAngle = approach(s.bankAngle, safe, AEP_ROLL_RATE * dt)
    } else {
      patch.bankAngle = approach(s.bankAngle, s.inducedBank, ROLLOFF_RATE * dt)
    }
    patch.curTrack = mod360(s.curTrack + (patch.bankAngle / 10) * dt)
  }

  // ---- Vertical ----
  // The position-based scenario engine owns the LPV glidepath; this light model
  // just clears any GS state and follows the autopilot's current vertical mode.
  patch.lpvPhase = null
  patch.gsDist = null
  patch.gsDev = 0
  // Flight states:
  //  • ENGAGED min-airspeed protection: a held nose-up (inducedClimb) climbs and
  //    bleeds speed; once MIN AS trips the AP lowers the nose to recover, then
  //    climbs again — pitch bobbing to hold the minimum.
  //  • DISENGAGED & banked: the nose drops into a descending spiral (rate &
  //    airspeed grow with bank); wings-level hands-off settles to level flight.
  const apClimb = s.apEngaged && s.inducedClimb && s.warning !== 'MIN_AS' // climbing, bleeding
  const minAsRecover = s.apEngaged && s.inducedClimb && s.warning === 'MIN_AS' // nose down to recover
  const banked = !s.apEngaged && Math.abs(s.bankAngle) > 3
  const diveBonus = banked ? DIVE_KT_PER_DEG * (Math.abs(s.bankAngle) - 3) : 0

  let targetVS
  if (minAsRecover) targetVS = -MINAS_RECOVER_VS // protection lowers the nose
  else if (apClimb) targetVS = CLIMB_VS // held nose-up
  else if (s.apEngaged) targetVS = userVerticalTargetVS(s)
  else if (banked) targetVS = -SPIRAL_VS_PER_DEG * Math.abs(s.bankAngle)
  else targetVS = 0 // disengaged, wings-level & hands-off
  const newVS = approach(s.curVS, targetVS, Math.abs(targetVS - s.curVS) * Math.min(1, VS_RESPONSE * dt))
  // Touchdown: clamp at the runway (TDZE) and bring the speed to zero.
  const rawAlt = s.curAlt + (newVS / 60) * dt
  const onGround = rawAlt <= TDZE
  patch.curAlt = onGround ? TDZE : rawAlt
  patch.curVS = onGround ? 0 : newVS
  if (onGround) patch.groundSpeed = 0

  // ---- Airspeed & pitch (light energy model for the PFD) ----
  // Normally the IAS follows the set ground speed (plus any dive over-speed);
  // a held nose-up bleeds it, and the min-airspeed recovery builds it back.
  const trimIAS = onGround ? 0 : Math.max(0, s.groundSpeed)
  let curIAS
  if (apClimb) curIAS = Math.max(STALL_FLOOR, s.curIAS - CLIMB_BLEED * dt)
  else if (minAsRecover) curIAS = Math.min(trimIAS, s.curIAS + MINAS_BUILD * dt)
  else {
    const tgt = trimIAS + diveBonus
    curIAS = approach(s.curIAS, tgt, Math.abs(tgt - s.curIAS) * Math.min(1, IAS_RESPONSE * dt))
  }
  patch.curIAS = curIAS
  const targetPitch = Math.max(-12, Math.min(12, patch.curVS * 0.012))
  patch.pitch = approach(s.pitch, targetPitch, Math.abs(targetPitch - s.pitch) * Math.min(1, PITCH_RESPONSE * dt))

  // ---- Ground speed & wind readout (airspeed +/- the wind along the heading) ----
  const tas = onGround ? 0 : Math.max(0, curIAS)
  const wind = tas > 0 ? windVector(s.curAlt - FIELD_ELEV, s.windDir, s.windSpd) : { wx: 0, wy: 0 }
  const hdgr = (magToTrue(patch.curTrack) * Math.PI) / 180
  const gx = tas * Math.sin(hdgr) + wind.wx
  const gy = tas * Math.cos(hdgr) + wind.wy
  patch.curGS = Math.round(Math.hypot(gx, gy))
  patch.curGT = patch.curGS > 1 ? Math.round(trueToMag(mod360((Math.atan2(gx, gy) * 180) / Math.PI))) : patch.curTrack
  patch.windNow = windAt(s.curAlt - FIELD_ELEV, s.windDir, s.windSpd)

  return patch
}

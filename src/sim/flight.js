// Light flight model. Pure function: given the current state and a timestep (s),
// returns a partial patch of the *actual* aircraft values (curTrack, curAlt, curVS,
// bankAngle). Selected/target values are user-driven and never changed here.

const TURN_RATE = 6 // deg/sec the autopilot rolls toward the selected track
const VS_RESPONSE = 4 // how quickly actual VS chases target VS (1/sec)
const CRUISE_IAS = 110 // nominal cruise indicated airspeed (kt)
const IAS_RESPONSE = 0.6 // how quickly IAS settles toward its target (1/sec)
const PITCH_RESPONSE = 2 // how quickly pitch settles toward its target (1/sec)

// Signed shortest angular difference a->b in (-180,180]
export function angleDiff(a, b) {
  let d = ((b - a + 540) % 360) - 180
  return d
}
export const mod360 = (x) => ((x % 360) + 360) % 360
const approach = (cur, target, maxStep) => {
  const d = target - cur
  if (Math.abs(d) <= maxStep) return target
  return cur + Math.sign(d) * maxStep
}

export function stepFlight(s, dt) {
  if (s.power !== 'on') return {}
  const patch = {}

  // ---- Lateral ----
  if (s.apEngaged && !s.emergencyLevel && !s.gyroMode) {
    const d = angleDiff(s.curTrack, s.selTrack)
    const step = Math.sign(d) * Math.min(Math.abs(d), TURN_RATE * dt)
    patch.curTrack = mod360(s.curTrack + step)
    // bank proportional to remaining turn, capped
    patch.bankAngle = Math.max(-25, Math.min(25, d))
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
  if (s.apEngaged) {
    if (s.verticalMode === 'SEL') {
      const dir = Math.sign(s.selAlt - s.curAlt)
      targetVS = dir * Math.abs(s.selVS || 500)
    } else if (s.verticalMode === 'GS_CPLD') {
      targetVS = -500 // descending on the glideslope
    } else if (s.verticalMode === 'ALTHOLD' || s.verticalMode === 'GS_ARM' || s.verticalMode === 'GS_FLG') {
      targetVS = 0
    } else {
      // SVS
      targetVS = s.selVS
    }
  } else {
    targetVS = s.curVS // free; coasts
  }
  const newVS = approach(s.curVS, targetVS, Math.abs(targetVS - s.curVS) * Math.min(1, VS_RESPONSE * dt))
  patch.curVS = newVS
  patch.curAlt = Math.max(0, s.curAlt + (newVS / 60) * dt)

  // ---- Airspeed & pitch (light model for the PFD) ----
  // Cruise IAS when flying, tapering off near the ground; trims back a touch in
  // a climb and gains a touch in a descent.
  const flying = s.groundSpeed > 10
  const targetIAS = flying ? Math.max(60, CRUISE_IAS - newVS / 100) : 0
  patch.curIAS = approach(s.curIAS, targetIAS, Math.abs(targetIAS - s.curIAS) * Math.min(1, IAS_RESPONSE * dt))
  // Pitch tracks vertical speed (≈12° at 1000 fpm), eased.
  const targetPitch = Math.max(-12, Math.min(12, newVS * 0.012))
  patch.pitch = approach(s.pitch, targetPitch, Math.abs(targetPitch - s.pitch) * Math.min(1, PITCH_RESPONSE * dt))

  return patch
}

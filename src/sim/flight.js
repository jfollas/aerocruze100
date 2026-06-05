// Light flight model. Pure function: given the current state and a timestep (s),
// returns a partial patch of the *actual* aircraft values (curTrack, curAlt, curVS,
// bankAngle). Selected/target values are user-driven and never changed here.

const TURN_RATE = 6 // deg/sec of heading change at full bank
const MAX_BANK = 25 // deg, the autopilot's commanded bank limit
const ROLL_RESPONSE = 1.5 // how quickly bank settles toward its target (1/sec)
const VS_RESPONSE = 4 // how quickly actual VS chases target VS (1/sec)
const CRUISE_IAS = 110 // nominal cruise indicated airspeed (kt)
const IAS_RESPONSE = 0.6 // how quickly IAS settles toward its target (1/sec)
const PITCH_RESPONSE = 2 // how quickly pitch settles toward its target (1/sec)
// Commanded fpm per foot of remaining altitude error. At 10 fpm/ft the easing
// leads the target by 10% of the vertical speed (e.g. 50 ft at 500 fpm).
const ALT_CAPTURE_GAIN = 10

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
const approach = (cur, target, maxStep) => {
  const d = target - cur
  if (Math.abs(d) <= maxStep) return target
  return cur + Math.sign(d) * maxStep
}

export function stepFlight(s, dt) {
  if (s.power !== 'on') return {}
  const patch = {}
  const onLpv = s.approachActive && s.skyviewCdi === 'flightplan'

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
    const d = angleDiff(s.curTrack, mod360(s.svHeadingBug))
    const targetBank = Math.max(-MAX_BANK, Math.min(MAX_BANK, d))
    const bank = approach(s.bankAngle, targetBank, Math.abs(targetBank - s.bankAngle) * Math.min(1, ROLL_RESPONSE * dt))
    patch.bankAngle = bank
    const turnStep = (bank / MAX_BANK) * TURN_RATE * dt
    patch.curTrack = mod360(s.curTrack + Math.sign(d) * Math.min(Math.abs(d), Math.abs(turnStep)))
    // established once we've rolled out on the intercept heading -> arm the GS
    if (lpvPhase === 'TURN' && Math.abs(d) < 1 && Math.abs(bank) < 1) {
      lpvPhase = 'ARM'
      gsDist = GS_ARM_NM
    }
  } else if (s.apEngaged && !s.emergencyLevel && !s.gyroMode) {
    const d = angleDiff(s.curTrack, s.selTrack)
    // Commanded bank is proportional to the remaining turn (so it rolls out as
    // we close on the track), but the actual bank eases toward it so the roll-in
    // is smooth instead of snapping to the limit.
    const targetBank = Math.max(-MAX_BANK, Math.min(MAX_BANK, d))
    const bank = approach(s.bankAngle, targetBank, Math.abs(targetBank - s.bankAngle) * Math.min(1, ROLL_RESPONSE * dt))
    patch.bankAngle = bank
    // Heading changes in proportion to the actual bank (coordinated turn), so the
    // turn eases in as the wings roll and eases out as they level. Clamp to the
    // remaining error to avoid overshoot.
    const turnStep = (bank / MAX_BANK) * TURN_RATE * dt
    patch.curTrack = mod360(s.curTrack + Math.sign(d) * Math.min(Math.abs(d), Math.abs(turnStep)))
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
    if (s.apEngaged) {
      if (s.verticalMode === 'SEL') {
        // Climb/descend at the selected VS, but ease the commanded VS down in
        // proportion to the remaining altitude error so we capture the target
        // smoothly (pitch and VS bleed off) instead of snapping to level.
        const altErr = s.selAlt - s.curAlt
        const cap = Math.abs(s.selVS || 500)
        targetVS = Math.max(-cap, Math.min(cap, altErr * ALT_CAPTURE_GAIN))
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
  }
  const newVS = approach(s.curVS, targetVS, Math.abs(targetVS - s.curVS) * Math.min(1, VS_RESPONSE * dt))
  patch.curVS = newVS
  patch.curAlt = Math.max(0, altBase + (newVS / 60) * dt)

  // ---- Airspeed & pitch (light model for the PFD) ----
  // Cruise IAS when flying, tapering off near the ground; trims back a touch in
  // a climb and gains a touch in a descent.
  const flying = s.groundSpeed > 10
  const targetIAS = flying ? (onLpv ? GS_APPROACH_IAS : Math.max(60, CRUISE_IAS - newVS / 100)) : 0
  patch.curIAS = approach(s.curIAS, targetIAS, Math.abs(targetIAS - s.curIAS) * Math.min(1, IAS_RESPONSE * dt))
  // Pitch tracks vertical speed (≈12° at 1000 fpm), eased.
  const targetPitch = Math.max(-12, Math.min(12, newVS * 0.012))
  patch.pitch = approach(s.pitch, targetPitch, Math.abs(targetPitch - s.pitch) * Math.min(1, PITCH_RESPONSE * dt))

  return patch
}

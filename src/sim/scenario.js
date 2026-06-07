// Position-based approach engine for the to-scale RNAV (GPS) RWY 10 scenario.
// Unlike the legacy scripted LPV demo in flight.js (which just counts down a
// fake distance), this integrates a real 2D aircraft position and flies the
// published flight plan, so the airplane can be drawn to scale on the chart and
// responds to how the user sets up the autopilot:
//   • GNS430W (IFR GPS) + GPSS  -> the GPS flies the lateral plan, the user
//     manages altitude down to the FAF, and the LPV glidepath couples at ZIMBO.
//   • SkyView source            -> the aircraft follows the HDG/ALT/VS bugs and
//     the user flies around; there is NO glideslope coupling.

import {
  approach,
  lateralStep,
  perfStep,
  userVerticalTargetVS,
  mod360,
  VS_RESPONSE,
  ALT_CAPTURE_GAIN,
  MAX_BANK,
  TURN_RATE,
} from './flight.js'
import {
  FIX_XY,
  TDZE,
  FIELD_ELEV,
  nmBetween,
  bearingToTrue,
  magToTrue,
  trueToMag,
} from './geo.js'
import { PLANS, gpssGuidance } from './navplan.js'
import { windVector, windAt, windCorrectedHeadingTrue } from './wind.js'

const GS_DOT_FT = 50 // glideslope deviation: feet of error per dot on the GSI
const GP_CAPTURE_BAND = 100 // ft you may sit above the glidepath and still capture (intercept-from-below)
const APPROACH_IAS = 90 // kt fallback used for guidance defaults
const FINAL_IAS = 100 // kt the scenario slows to once inside the FAF
// Bank limit that yields a standard-rate (3°/sec) turn in this model, so GPSS
// fly-by transitions arc onto the next leg like a Garmin 430.
const GPSS_BANK = MAX_BANK * (3 / TURN_RATE)
const FAF_ALT = 2300 // ft MSL, the ZIMBO (FAF) crossing altitude / glidepath intercept
const FAF_DTHR = nmBetween(FIX_XY.ZIMBO, FIX_XY.RW10) // nm, ZIMBO -> threshold (~4.9)
const GP_GRADIENT = (FAF_ALT - TDZE) / FAF_DTHR // ft of altitude lost per nm down the final
const toRad = (d) => (d * Math.PI) / 180
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x))

// Glidepath altitude (ft MSL) at a slant distance `dThr` (nm) from the runway
// threshold: a constant-gradient path anchored at the runway (TDZE) and the FAF
// (2300 ft at ZIMBO), so a level aircraft at the 2300 platform intercepts the
// path right at ZIMBO — not a fraction of a mile before it.
function glidepathAlt(dThrNm) {
  return TDZE + dThrNm * GP_GRADIENT
}

// WAAS/GPS CDI full-scale sensitivity by phase of flight, faithful to a GNS430W:
//   • En route  (>30 NM from the airport)          : ±2.0 NM
//   • Terminal  (≤30 NM, >2 NM before the FAF)      : ±1.0 NM
//   • Approach  (final 2 NM into the FAF)           : ramps 1.0 -> 0.3 NM
//   • LPV final (inside the FAF)                    : angular, ILS-like — the
//       full scale tightens from 0.3 NM at the FAF toward ~350 ft (0.06 NM) at
//       the threshold, so the needle converges on the runway like a localizer.
// `angular` flags the LPV final so the PFD annunciates "LPV" instead of an NM.
const APR_SENS = 0.3 // NM full-scale at/inside the FAF
const TERM_SENS = 1.0 // NM full-scale in the terminal area
const ENR_SENS = 2.0 // NM full-scale en route
const APR_RAMP_NM = 2.0 // distance before the FAF over which 1.0 -> 0.3
const LPV_FLOOR = 0.06 // NM (~350 ft), the tightest LPV full-scale near the runway
function cdiSensitivity(legIdx, planLen, dThrNm, pos) {
  if (legIdx >= planLen - 1) {
    // Final leg (ZIMBO -> RW10): angular splay from the runway, capped at 0.3 NM.
    const scale = clamp(dThrNm * (APR_SENS / FAF_DTHR), LPV_FLOOR, APR_SENS)
    return { scale, angular: true }
  }
  if (dThrNm > 30) return { scale: ENR_SENS, angular: false }
  const dFaf = nmBetween(pos, FIX_XY.ZIMBO) // nm to the FAF along the inbound legs
  if (dFaf < APR_RAMP_NM) {
    // Linear ramp: 0.3 NM at the FAF up to 1.0 NM at 2 NM out.
    return { scale: APR_SENS + ((TERM_SENS - APR_SENS) / APR_RAMP_NM) * dFaf, angular: false }
  }
  return { scale: TERM_SENS, angular: false }
}

export function stepScenario(s, dt) {
  if (s.power === 'off' && s.groundSpeed <= 10) return {} // parked & unpowered
  const patch = {}

  // Approach speed: cruise toward the FAF, then slow for the final segment so the
  // tutorial doesn't dawdle. Once inside the FAF (ZIMBO) cap the speed at 100 kt
  // and ease to it; outside the FAF keep the pilot's set speed (never speed it up).
  const dThr0 = nmBetween({ x: s.curX, y: s.curY }, FIX_XY.RW10)
  const spdTarget = dThr0 <= FAF_DTHR ? Math.min(s.groundSpeed, FINAL_IAS) : s.groundSpeed
  const spd = approach(s.groundSpeed, spdTarget, 20 * dt)
  const tas = spd > 10 ? spd : 0 // commanded true airspeed

  // Wind at the present altitude (gradient aloft; backed & slower near the
  // ground). The aircraft's ground vector is its air vector plus the wind.
  const wind = tas > 0 ? windVector(s.curAlt - FIELD_ELEV, s.windDir, s.windSpd) : { wx: 0, wy: 0 }
  patch.windNow = windAt(s.curAlt - FIELD_ELEV, s.windDir, s.windSpd)

  // The ground track & speed the GPS sees from the current heading (wind-drifted).
  const hdg0 = toRad(magToTrue(s.curTrack))
  const gx0 = tas * Math.sin(hdg0) + wind.wx
  const gy0 = tas * Math.cos(hdg0) + wind.wy
  const gsCur = Math.hypot(gx0, gy0)
  const gtCur = mod360((Math.atan2(gx0, gy0) * 180) / Math.PI)

  // ===== Lateral: pick the commanded GROUND track =====
  // The autopilot flies the GPS flight plan (lateral course + LPV glidepath)
  // either via GPSS with the 430W, OR in SkyView mode when the SkyView CDI is
  // showing a flight plan — the SkyView passes the GPS course through, so it's
  // the same guidance as the 430W (Install Manual §10).
  const onGpss =
    s.apEngaged &&
    ((s.lateralMode === 'GPSS' && s.gpsData === 'ifr') ||
      (s.lateralMode === 'SKYVIEW' && s.skyviewCdi === 'flightplan'))
  const plan = s.scenarioIaf ? PLANS[s.scenarioIaf] : null
  let targetTrack = s.selTrack
  let activeLeg = s.activeLeg

  patch.cdiDev = 0 // lateral course deviation in dots (+ = course is right, fly right)
  patch.cdiScale = null // CDI full-scale sensitivity (NM)
  patch.cdiAngular = false // true on the LPV final, where scaling is angular (ILS-like)
  patch.cdiToFrom = null // TO/FROM flag
  if (onGpss && plan) {
    const legIdx = clamp(s.activeLeg || 1, 1, plan.length - 1)
    const g = gpssGuidance(plan, legIdx, { x: s.curX, y: s.curY }, gsCur || APPROACH_IAS, gtCur)
    activeLeg = g.sequence ? Math.min(g.nextLegIdx, plan.length - 1) : legIdx
    targetTrack = trueToMag(g.commandedTrackTrue)
    patch.selTrack = Math.round(mod360(targetTrack)) // reflect the GPS course on the bug
    const { scale, angular } = cdiSensitivity(legIdx, plan.length, dThr0, { x: s.curX, y: s.curY })
    patch.cdiDev = clamp((-g.xtkNm / scale) * 3, -3.5, 3.5) // 3 dots = full scale
    patch.cdiScale = scale
    patch.cdiAngular = angular
    patch.cdiToFrom = g.toFrom
  }
  patch.activeLeg = activeLeg

  // Desired track of the active leg (magnetic) — drives the HSI course needle,
  // and updates as the flight plan sequences from leg to leg.
  if (plan) {
    const li = clamp(activeLeg, 1, plan.length - 1)
    patch.gpsDtk = Math.round(trueToMag(bearingToTrue(plan[li - 1], plan[li])))
  } else {
    patch.gpsDtk = null
  }

  // Steer the HEADING. In a tracking mode the desired GROUND track is converted
  // to the heading that makes it good in the wind (the autopilot crabs); the
  // disengaged / gyro cases just hold a heading and let the wind drift them.
  if (s.apEngaged && !s.emergencyLevel && !s.gyroMode) {
    const cmdHdg = trueToMag(windCorrectedHeadingTrue(magToTrue(targetTrack), wind, tas))
    // GPSS flies fly-by turns at standard rate; manual TRK uses the full bank
    const { bankAngle, curTrack } = lateralStep(s, dt, cmdHdg, onGpss ? GPSS_BANK : MAX_BANK)
    patch.bankAngle = bankAngle
    patch.curTrack = curTrack
  } else if (s.apEngaged && s.emergencyLevel) {
    patch.bankAngle = approach(s.bankAngle, 0, 30 * dt)
    patch.curTrack = s.curTrack
  } else if (s.apEngaged && s.gyroMode) {
    patch.bankAngle = approach(s.bankAngle, s.selBank, 30 * dt)
    patch.curTrack = mod360(s.curTrack + (patch.bankAngle / 10) * dt)
  } else {
    patch.bankAngle = approach(s.bankAngle, s.inducedBank, 30 * dt)
    patch.curTrack = mod360(s.curTrack + (patch.bankAngle / 10) * dt)
  }

  // ===== Position integration: air vector (new heading) + wind =====
  const hdg = toRad(magToTrue(patch.curTrack))
  const gx = tas * Math.sin(hdg) + wind.wx
  const gy = tas * Math.cos(hdg) + wind.wy
  patch.curX = s.curX + (gx / 3600) * dt
  patch.curY = s.curY + (gy / 3600) * dt
  patch.curGS = Math.round(Math.hypot(gx, gy)) // actual ground speed (air + wind)
  // actual ground track (magnetic) — differs from the heading by the crab angle
  patch.curGT = patch.curGS > 1 ? Math.round(trueToMag(mod360((Math.atan2(gx, gy) * 180) / Math.PI))) : patch.curTrack
  const pos = { x: patch.curX, y: patch.curY }

  // ===== Vertical =====
  // The glideslope only couples on the direct IFR-GPS (430W) path. Through the
  // SkyView the autopilot gets the lateral course + the bugs but NOT the GPS
  // vertical guidance, so the pilot flies the vertical with the ALT/VS bugs
  // (stepdowns for LNAV, or hand-flying an LPV glideslope) — no GS coupling.
  const onApproach = s.apEngaged && s.lateralMode === 'GPSS' && s.gpsData === 'ifr' && s.approachActive && plan
  const dThr = nmBetween(pos, FIX_XY.RW10)
  const gpAlt = glidepathAlt(dThr)

  let coupled = s.verticalMode === 'GS_CPLD'
  let lpvPhase = null
  if (onApproach) {
    const armed = activeLeg >= plan.length - 2 // established inbound on the approach course
    // Couple at the FAF when level/descending (not while flying a missed-approach
    // climb, which leaves verticalMode as SVS with a positive selVS).
    const readyToCouple =
      s.verticalMode === 'ALTHOLD' ||
      s.verticalMode === 'GS_ARM' ||
      s.verticalMode === 'SEL' ||
      (s.verticalMode === 'SVS' && s.selVS <= 0)
    // Couple from BELOW only, as real WAAS/LPV autopilots do: the glidepath has
    // to descend to meet the aircraft. You needn't be exactly at the 2300 ft
    // platform — anywhere on the to-FAF leg, at or below the (sloping) path,
    // works, so a higher-but-on-course aircraft intercepts and starts down
    // before ZIMBO. But arriving well ABOVE the path won't couple (intercept-
    // from-above is rejected); you'd fly through it and need VS to re-intercept.
    const captured = gpAlt <= s.curAlt && s.curAlt - gpAlt <= GP_CAPTURE_BAND
    if (!coupled && armed && readyToCouple && captured) {
      coupled = true
      patch.verticalMode = 'GS_CPLD'
    } else if (!coupled && armed && (s.verticalMode === 'ALTHOLD' || s.verticalMode === 'GS_ARM')) {
      // Established inbound and holding the platform: annunciate GS ARM on the
      // autopilot itself (the glideslope is armed and will couple when the path
      // is intercepted at the FAF), not just on the PFD.
      patch.verticalMode = 'GS_ARM'
    }
    lpvPhase = coupled ? 'CPLD' : armed ? 'ARM' : null
  }

  let targetVS
  if (coupled) {
    // Feed-forward the nominal descent rate that keeps us on the moving 3.04°
    // path (so the needle stays centred), plus a proportional term that nulls
    // any residual deviation.
    const pathRate = -((gsCur || APPROACH_IAS) / 60) * GP_GRADIENT
    targetVS = clamp(pathRate + (gpAlt - s.curAlt) * ALT_CAPTURE_GAIN, -900, 200)
  } else {
    targetVS = userVerticalTargetVS(s) // user manages the altitude (ALT HOLD / SEL / SVS)
  }
  const newVS = approach(s.curVS, targetVS, Math.abs(targetVS - s.curVS) * Math.min(1, VS_RESPONSE * dt))
  // Touchdown: clamp at the runway (TDZE) and bring the speed to zero.
  const rawAlt = s.curAlt + (newVS / 60) * dt
  const onGround = rawAlt <= TDZE
  patch.curAlt = onGround ? TDZE : rawAlt
  patch.curVS = onGround ? 0 : newVS
  patch.groundSpeed = onGround ? 0 : spd // the (eased) approach speed
  if (onGround) patch.curGS = 0

  // glideslope deviation for the PFD GSI (+ = below path, fly up)
  patch.gsDev = onApproach ? clamp(-(patch.curAlt - gpAlt) / GS_DOT_FT, -2, 2) : 0
  patch.lpvPhase = lpvPhase
  patch.gsDist = onApproach ? dThr : null

  // height above field for the 700-AGL autopilot floor warning
  patch.agl = patch.curAlt - FIELD_ELEV

  // ===== Airspeed & pitch =====
  // IAS follows the simulated ground speed (the scenario-managed approach speed,
  // or the pilot's setting via the speed-tape / Ground speed control), eased.
  const { curIAS, pitch } = perfStep(s, dt, patch.curVS, onGround ? 0 : Math.max(0, spd))
  patch.curIAS = curIAS
  patch.pitch = pitch

  return patch
}

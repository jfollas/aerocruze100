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
const APPROACH_IAS = 90 // kt flown on the approach
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

export function stepScenario(s, dt) {
  if (s.power === 'off' && s.groundSpeed <= 10) return {} // parked & unpowered
  const patch = {}
  const tas = s.groundSpeed > 10 ? s.groundSpeed : 0 // commanded true airspeed

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
  patch.cdiToFrom = null // TO/FROM flag
  if (onGpss && plan) {
    const legIdx = clamp(s.activeLeg || 1, 1, plan.length - 1)
    const g = gpssGuidance(plan, legIdx, { x: s.curX, y: s.curY }, gsCur || APPROACH_IAS, gtCur)
    activeLeg = g.sequence ? Math.min(g.nextLegIdx, plan.length - 1) : legIdx
    targetTrack = trueToMag(g.commandedTrackTrue)
    patch.selTrack = Math.round(mod360(targetTrack)) // reflect the GPS course on the bug
    // course deviation: tighter full-scale on the final approach segment
    const fullScale = legIdx >= plan.length - 1 ? 0.3 : 1.0
    patch.cdiDev = clamp((-g.xtkNm / fullScale) * 3, -3.5, 3.5) // 3 dots = full scale
    patch.cdiScale = fullScale
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
      s.verticalMode === 'ALTHOLD' || s.verticalMode === 'SEL' || (s.verticalMode === 'SVS' && s.selVS <= 0)
    // Couple only when the glidepath has actually descended to the aircraft (the
    // intercept at ZIMBO) — not the instant the final leg sequences, which would
    // start the descent slightly before the FAF.
    const captured = gpAlt <= s.curAlt
    if (!coupled && armed && readyToCouple && captured) {
      coupled = true
      patch.verticalMode = 'GS_CPLD'
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
  if (onGround) {
    patch.groundSpeed = 0
    patch.curGS = 0
  }

  // glideslope deviation for the PFD GSI (+ = below path, fly up)
  patch.gsDev = onApproach ? clamp(-(patch.curAlt - gpAlt) / GS_DOT_FT, -2, 2) : 0
  patch.lpvPhase = lpvPhase
  patch.gsDist = onApproach ? dThr : null

  // height above field for the 700-AGL autopilot floor warning
  patch.agl = patch.curAlt - FIELD_ELEV

  // ===== Airspeed & pitch =====
  // IAS follows the simulated ground speed (set via the speed-tape drag or the
  // Ground speed control), eased.
  const { curIAS, pitch } = perfStep(s, dt, patch.curVS, onGround ? 0 : Math.max(0, s.groundSpeed))
  patch.curIAS = curIAS
  patch.pitch = pitch

  return patch
}

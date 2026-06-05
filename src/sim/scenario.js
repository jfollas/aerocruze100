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
  GLIDE_ANGLE,
  nmBetween,
  bearingToTrue,
  magToTrue,
  trueToMag,
} from './geo.js'
import { PLANS, gpssGuidance } from './navplan.js'

const FT_PER_NM = 6076.12
const GS_DOT_FT = 50 // glideslope deviation: feet of error per dot on the GSI
const APPROACH_IAS = 90 // kt flown on the approach
// Bank limit that yields a standard-rate (3°/sec) turn in this model, so GPSS
// fly-by transitions arc onto the next leg like a Garmin 430.
const GPSS_BANK = MAX_BANK * (3 / TURN_RATE)
const toRad = (d) => (d * Math.PI) / 180
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x))

// Glidepath altitude (ft MSL) at a slant distance `dThr` (nm) from the runway
// threshold, for the published 3.04° LPV path.
function glidepathAlt(dThrNm) {
  return TDZE + dThrNm * FT_PER_NM * Math.tan(toRad(GLIDE_ANGLE))
}

export function stepScenario(s, dt) {
  if (s.power !== 'on') return {}
  const patch = {}
  const gs = s.groundSpeed > 10 ? s.groundSpeed : 0

  // ===== Lateral: pick the commanded track =====
  const onGpss = s.apEngaged && s.lateralMode === 'GPSS' && s.gpsData === 'ifr'
  const plan = s.scenarioIaf ? PLANS[s.scenarioIaf] : null
  let targetTrack = s.selTrack
  let activeLeg = s.activeLeg

  patch.cdiDev = 0 // lateral course deviation in dots (+ = course is right, fly right)
  patch.cdiScale = null // CDI full-scale sensitivity (NM)
  patch.cdiToFrom = null // TO/FROM flag
  if (onGpss && plan) {
    const legIdx = clamp(s.activeLeg || 1, 1, plan.length - 1)
    const g = gpssGuidance(plan, legIdx, { x: s.curX, y: s.curY }, gs || APPROACH_IAS, magToTrue(s.curTrack))
    activeLeg = g.sequence ? Math.min(g.nextLegIdx, plan.length - 1) : legIdx
    targetTrack = trueToMag(g.commandedTrackTrue)
    patch.selTrack = Math.round(mod360(targetTrack)) // reflect the GPS course on the bug
    // course deviation: tighter full-scale on the final approach segment
    const fullScale = legIdx >= plan.length - 1 ? 0.3 : 1.0
    patch.cdiDev = clamp(-g.xtkNm / fullScale * 3, -3.5, 3.5) // 3 dots = full scale
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

  // Steer toward the target track (same eased bank/turn law as the AP).
  if (s.apEngaged && !s.emergencyLevel && !s.gyroMode) {
    // GPSS flies fly-by turns at standard rate; manual TRK uses the full bank
    const { bankAngle, curTrack } = lateralStep(s, dt, targetTrack, onGpss ? GPSS_BANK : MAX_BANK)
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

  // ===== Position integration (uses the freshly-computed track) =====
  const trkTrue = magToTrue(patch.curTrack)
  const distNm = (gs / 3600) * dt
  patch.curX = s.curX + distNm * Math.sin(toRad(trkTrue))
  patch.curY = s.curY + distNm * Math.cos(toRad(trkTrue))
  const pos = { x: patch.curX, y: patch.curY }

  // ===== Vertical =====
  const onApproach = onGpss && s.approachActive && plan
  const dThr = nmBetween(pos, FIX_XY.RW10)
  const gpAlt = glidepathAlt(dThr)

  let coupled = s.verticalMode === 'GS_CPLD'
  let lpvPhase = null
  if (onApproach) {
    const onFinal = activeLeg >= plan.length - 1 // sequenced past ZIMBO onto the final
    const armed = activeLeg >= plan.length - 2 // on the UBAYA -> ZIMBO leg or beyond
    // Couple at the FAF when level/descending (not while flying a missed-approach
    // climb, which leaves verticalMode as SVS with a positive selVS).
    const readyToCouple =
      s.verticalMode === 'ALTHOLD' || s.verticalMode === 'SEL' || (s.verticalMode === 'SVS' && s.selVS <= 0)
    if (!coupled && onFinal && readyToCouple) {
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
    const pathRate = -((gs || APPROACH_IAS) * FT_PER_NM / 60) * Math.tan(toRad(GLIDE_ANGLE))
    targetVS = clamp(pathRate + (gpAlt - s.curAlt) * ALT_CAPTURE_GAIN, -900, 200)
  } else {
    targetVS = userVerticalTargetVS(s) // user manages the altitude (ALT HOLD / SEL / SVS)
  }
  const newVS = approach(s.curVS, targetVS, Math.abs(targetVS - s.curVS) * Math.min(1, VS_RESPONSE * dt))
  patch.curVS = newVS
  patch.curAlt = Math.max(0, s.curAlt + (newVS / 60) * dt)

  // glideslope deviation for the PFD GSI (+ = below path, fly up)
  patch.gsDev = onApproach ? clamp(-(patch.curAlt - gpAlt) / GS_DOT_FT, -2, 2) : 0
  patch.lpvPhase = lpvPhase
  patch.gsDist = onApproach ? dThr : null

  // height above field for the 700-AGL autopilot floor warning
  patch.agl = patch.curAlt - FIELD_ELEV

  // ===== Airspeed & pitch =====
  // IAS follows the simulated ground speed (set via the speed-tape drag or the
  // Ground speed control), eased.
  const { curIAS, pitch } = perfStep(s, dt, newVS, Math.max(0, s.groundSpeed))
  patch.curIAS = curIAS
  patch.pitch = pitch

  return patch
}

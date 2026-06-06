// Static flight plans for the RNAV (GPS) RWY 10 at 1G0 and the GPSS lateral
// guidance that flies them. A plan is an ordered list of waypoints; the "active
// leg" `legIdx` runs from plan[legIdx-1] (from) to plan[legIdx] (to). Only the
// straight-in T-bar entries (LEYIR / WUDAT, both NoPT) are modelled here; the
// UBAYA hold-in-lieu procedure turn is a later phase.

import { FIX_XY, bearingToTrue, nmBetween } from './geo.js'
import { angleDiff, mod360 } from './flight.js'

const wp = (name) => ({ name, ...FIX_XY[name] })

// Common final tail: UBAYA -> ZIMBO (FAF) -> RW10 (threshold/MAP).
const TAIL = ['UBAYA', 'ZIMBO', 'RW10']

// ---- UBAYA hold-in-lieu-of-procedure-turn (HILPT) ----
// As charted: a RIGHT-turn racetrack with the inbound leg on the 096° final
// approach course and the racetrack south of it (holding side = south), 4 NM
// legs. Depending on the arrival direction the 430W flies a direct, teardrop,
// or parallel entry, ending established inbound at UBAYA to continue
// UBAYA -> ZIMBO -> RW10.
const HOLD_LEG = 4 // nm
const HOLD_R = 0.55 // nm, ~standard-rate turn radius at hold speed
const U = FIX_XY.UBAYA
const INB_T = bearingToTrue(U, FIX_XY.ZIMBO) // inbound course (true)
const rad = (d) => (d * Math.PI) / 180
const unit = (degTrue) => ({ x: Math.sin(rad(degTrue)), y: Math.cos(rad(degTrue)) })
const add = (p, v, s = 1) => ({ x: p.x + v.x * s, y: p.y + v.y * s })
const E_IN = unit(INB_T)
const E_OUT = unit(INB_T + 180)
const HOLD_SIDE = unit(INB_T + 90) // right of inbound = south (the holding side)

// Inbound leg start (4 NM west of UBAYA) — the rollout point shared by the
// course-reversal entries below.
const A = add(U, E_OUT, HOLD_LEG)
const uwp = { name: 'UBAYA', ...U }
const tail = TAIL.slice(1).map(wp) // ZIMBO, RW10 (after re-crossing UBAYA inbound)

// From the west you arrive established on the final approach course, so no
// course reversal is needed — fly straight in (NoPT): UBAYA -> ZIMBO -> RW10.
const directPlan = [{ name: 'START', ...add(U, E_IN, -5) }, uwp, ...tail]
// Teardrop: arrive from the SE (holding side); cross UBAYA, fly the 30°-offset
// teardrop into the holding side, then turn back onto the inbound leg.
const TD = add(U, unit(INB_T + 150), HOLD_LEG) // 30° off the outbound, toward the south
const teardropPlan = [
  { name: 'START', ...add(U, unit(INB_T + 45), 5) },
  uwp,
  { name: 'td', ...TD },
  { name: 'hold', ...A },
  uwp,
  ...tail,
]
// Parallel: arrive from the NE (non-holding side); cross UBAYA, parallel the
// outbound course on the north side, then turn back to intercept inbound.
const PAR = add(add(U, E_OUT, HOLD_LEG), HOLD_SIDE, -2 * HOLD_R) // 4 NM west, offset north
const parallelPlan = [
  { name: 'START', ...add(U, unit(INB_T - 45), 5) },
  uwp,
  { name: 'pl', ...PAR },
  uwp,
  ...tail,
]

export const PLANS = {
  LEYIR: ['LEYIR', ...TAIL].map(wp),
  WUDAT: ['WUDAT', ...TAIL].map(wp),
  UBAYA_DIRECT: directPlan,
  UBAYA_TEARDROP: teardropPlan,
  UBAYA_PARALLEL: parallelPlan,
}

// What each UBAYA plan flies (for annunciation): from the west it's a straight-in
// (NoPT); from the east the 430W flies the hold-in-lieu course reversal.
export const PLAN_ENTRY = {
  UBAYA_DIRECT: 'NoPT',
  UBAYA_TEARDROP: 'TEARDROP',
  UBAYA_PARALLEL: 'PARALLEL',
}

// Which HILPT entry the 430W computes for an arrival position relative to UBAYA:
// west of the fix -> direct; east + holding side (south) -> teardrop; east +
// non-holding side (north) -> parallel.
export function holdEntry(pos) {
  const along = (pos.x - U.x) * E_IN.x + (pos.y - U.y) * E_IN.y
  const cross = (pos.x - U.x) * HOLD_SIDE.x + (pos.y - U.y) * HOLD_SIDE.y
  if (along < 0) return 'DIRECT'
  return cross > 0 ? 'TEARDROP' : 'PARALLEL'
}

// How aggressively to chase the course line: degrees of intercept per nm of
// cross-track error, capped at a 45° intercept.
const XTK_GAIN = 45
const MAX_INTERCEPT = 45

// Standard-rate (3°/sec) turn radius in nm: r = v / (60π).
const turnRadiusNm = (groundSpeed) => Math.max(groundSpeed, 1) / (60 * Math.PI)

// Heading error (deg) below which we consider the aircraft established on the
// leg and switch from "turn onto the course" to cross-track fine tracking.
const ESTABLISHED_DEG = 8

// GPSS guidance for the active leg. Returns the commanded TRUE track to fly,
// the signed cross-track error (+ = right of course), and whether to sequence
// to the next leg. `trackTrue` is the aircraft's current true track.
export function gpssGuidance(plan, legIdx, pos, groundSpeed, trackTrue) {
  const A = plan[legIdx - 1]
  const B = plan[legIdx]
  const legCourse = bearingToTrue(A, B)

  // along/cross-track decomposition relative to the A->B line
  const legDx = B.x - A.x
  const legDy = B.y - A.y
  const legLen = Math.hypot(legDx, legDy) || 1
  const ux = legDx / legLen
  const uy = legDy / legLen
  const relx = pos.x - A.x
  const rely = pos.y - A.y
  const along = relx * ux + rely * uy
  const xtk = uy * relx - ux * rely // + = right of course

  // While turning onto the leg (heading well off the course), command the leg
  // course itself so the standard-rate turn arcs smoothly onto it (a fly-by).
  // Once roughly established, switch to a cross-track intercept for fine
  // tracking. (trackTrue may be undefined in unit tests -> behave as established.)
  const hdgErr = trackTrue == null ? 0 : Math.abs(angleDiff(trackTrue, legCourse))
  let commandedTrackTrue
  if (hdgErr > ESTABLISHED_DEG) {
    commandedTrackTrue = legCourse
  } else {
    const intercept = Math.max(-MAX_INTERCEPT, Math.min(MAX_INTERCEPT, XTK_GAIN * xtk))
    commandedTrackTrue = mod360(legCourse - intercept)
  }

  // sequencing — never sequence off the final leg (B is the last waypoint)
  const isFinalLeg = legIdx >= plan.length - 1
  let sequence = false
  if (!isFinalLeg) {
    const nextCourse = bearingToTrue(B, plan[legIdx + 1])
    // cap the course change so tight hold turns (>=90°) don't blow up the lead
    const turn = Math.min(Math.abs(angleDiff(legCourse, nextCourse)), 120)
    const ata = turnRadiusNm(groundSpeed) * Math.tan((turn / 2) * (Math.PI / 180))
    const dtg = nmBetween(pos, B)
    sequence = dtg <= Math.max(ata, 0.3) || along >= legLen
  }

  // TO/FROM: the active waypoint B is ahead (TO) until we fly past it (FROM).
  const toFrom = along < legLen ? 'TO' : 'FROM'

  return { commandedTrackTrue, xtkNm: xtk, sequence, nextLegIdx: legIdx + 1, toFrom }
}

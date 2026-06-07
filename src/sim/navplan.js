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
const HOLD_SIDE = unit(INB_T + 90) // right of inbound = south (the holding side)

const uwp = { name: 'UBAYA', ...U }
const tail = TAIL.slice(1).map(wp) // ZIMBO, RW10 (after re-crossing UBAYA inbound)

// From the west you arrive established on the final approach course, so no
// course reversal is needed — fly straight in (NoPT): UBAYA -> ZIMBO -> RW10.
const directPlan = [{ name: 'START', ...add(U, E_IN, -5) }, uwp, ...tail]
// Teardrop: arrive from the NE (~232° to the fix) in the teardrop sector. Cross
// UBAYA, fly the outbound course tilted 30° toward the holding side (246°) for
// one leg, then a standard-rate RIGHT turn (the hold direction) of 210° that
// rolls out established on the 096° inbound course, and track it back to UBAYA.
// The 30° offset + standard-rate radius keep the whole turn on the holding side
// and roll out right on the course (no separate intercept leg needed).
const TD_OB = INB_T + 150 // 246° = outbound (276°) tilted 30° toward the holding side
const TD_OUT = (HOLD_R * (1 + Math.cos(rad(30)))) / Math.sin(rad(30)) // leg length to roll out on course
const TD_C = add(add(U, unit(TD_OB), TD_OUT), unit(TD_OB + 90), HOLD_R) // right-turn center
const TD_ARC = []
for (let k = 0; k <= 6; k++) {
  // sweep 210° with bearing increasing (a right turn) from the outbound end
  // (k=0) around the holding side to the 096° rollout on the course (k=6)
  TD_ARC.push({ name: 'td' + k, ...add(TD_C, unit(TD_OB - 90 + (210 * k) / 6), HOLD_R) })
}
const teardropPlan = [
  { name: 'START', ...add(U, unit(INB_T - 45), 5) },
  uwp,
  ...TD_ARC, // outbound end through the 210° right turn onto the inbound course
  uwp,
  ...tail,
]
// Parallel: arrive from the SE — inbound heading (~315°) lands in the parallel
// sector. Cross UBAYA, turn to the outbound course (276°) and fly it for one
// leg, then a constant standard-rate LEFT turn (opposite the right-hand hold)
// through 210° to roll out on 066°, hold that until intercepting the 096°
// inbound course, then track it back to UBAYA. Built as line -> arc -> line ->
// intercept (the turn sampled into points) so it flies and renders true.
const OB = INB_T + 180 // outbound course (276°)
const EH = INB_T - 30 // post-turn heading (066° = a 30° intercept of the inbound)
const PAR_C = add(add(U, unit(OB), HOLD_LEG), unit(OB - 90), HOLD_R) // left-turn center
const PAR_ARC = []
for (let k = 0; k <= 6; k++) {
  // sweep 210° clockwise-in-bearing-decreasing (a left turn) from the outbound
  // end (k=0, on the course line) around to the 066° rollout (k=6)
  PAR_ARC.push({ name: 'pl' + k, ...add(PAR_C, unit(OB + 90 - (210 * k) / 6), HOLD_R) })
}
const PAR_ET = PAR_ARC[PAR_ARC.length - 1] // end of the turn, heading 066°
const ehv = unit(EH)
// distance along 066° from the rollout to where it crosses the inbound course
const tInt = -((PAR_ET.x - U.x) * HOLD_SIDE.x + (PAR_ET.y - U.y) * HOLD_SIDE.y) / (ehv.x * HOLD_SIDE.x + ehv.y * HOLD_SIDE.y)
const PAR_I = add(PAR_ET, ehv, tInt) // intercept point on the 096° course
const parallelPlan = [
  { name: 'START', ...add(U, unit(INB_T + 45), 5) },
  uwp,
  ...PAR_ARC, // outbound end (on the course) through the 210° left turn
  { name: 'pi', ...PAR_I }, // roll out and intercept the inbound course
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

// Which HILPT entry the 430W computes for an arrival position relative to UBAYA.
// Entry sectors are based on the inbound heading to the fix (a direct-to arrival
// heads opposite the bearing from the fix). For this right-turn hold (inbound
// 096°, holding side south): west of the fix you're established -> direct; from
// the SE you arrive heading ~315° (parallel sector); from the NE you arrive
// heading ~225° (teardrop sector). The teardrop/parallel sectors sit opposite
// the side you're physically on because they key off heading, not position.
export function holdEntry(pos) {
  const along = (pos.x - U.x) * E_IN.x + (pos.y - U.y) * E_IN.y
  const cross = (pos.x - U.x) * HOLD_SIDE.x + (pos.y - U.y) * HOLD_SIDE.y
  if (along < 0) return 'DIRECT'
  return cross > 0 ? 'PARALLEL' : 'TEARDROP' // south/SE -> parallel, north/NE -> teardrop
}

// How aggressively to chase the course line: degrees of intercept per nm of
// cross-track error, capped at a 45° intercept.
const XTK_GAIN = 45
const MAX_INTERCEPT = 45

// Standard-rate (3°/sec) turn radius in nm: r = v / (60π).
const turnRadiusNm = (groundSpeed) => Math.max(groundSpeed, 1) / (60 * Math.PI)

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

  // Continuous cross-track intercept: command a track offset from the course
  // proportional to the cross-track error, capped at a 45° intercept. As the
  // aircraft nears the line the intercept eases off, so it captures smoothly and
  // — being bank-rate-limited — still arcs onto the leg like a fly-by. (We used
  // to hard-switch to "command the raw leg course" while the heading was >8° off,
  // but that discontinuity made the bank hunt: the intercept command itself
  // re-grew the heading error past the threshold, so the law toggled every few
  // ticks and the bank chattered shallowly around level while holding course.)
  const intercept = Math.max(-MAX_INTERCEPT, Math.min(MAX_INTERCEPT, XTK_GAIN * xtk))
  const commandedTrackTrue = mod360(legCourse - intercept)

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

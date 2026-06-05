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

export const PLANS = {
  LEYIR: ['LEYIR', ...TAIL].map(wp),
  WUDAT: ['WUDAT', ...TAIL].map(wp),
}

export const FAF = 'ZIMBO'

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
    const turn = Math.abs(angleDiff(legCourse, nextCourse))
    const ata = turnRadiusNm(groundSpeed) * Math.tan((turn / 2) * (Math.PI / 180))
    const dtg = nmBetween(pos, B)
    sequence = dtg <= Math.max(ata, 0.3) || along >= legLen
  }

  // TO/FROM: the active waypoint B is ahead (TO) until we fly past it (FROM).
  const toFrom = along < legLen ? 'TO' : 'FROM'

  return { commandedTrackTrue, xtkNm: xtk, sequence, nextLegIdx: legIdx + 1, toFrom }
}

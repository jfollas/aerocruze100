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
const XTK_GAIN = 8
const MAX_INTERCEPT = 45

// Standard-rate turn radius (nm) for turn anticipation.
const turnRadiusNm = (groundSpeed) => Math.max(groundSpeed, 1) / (20 * Math.PI)

// GPSS guidance for the active leg. Returns the commanded TRUE track to fly,
// the signed cross-track error (+ = right of course), and whether to sequence
// to the next leg.
export function gpssGuidance(plan, legIdx, pos, groundSpeed) {
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

  // intercept: steer toward the course, easing to on-course tracking
  const intercept = Math.max(-MAX_INTERCEPT, Math.min(MAX_INTERCEPT, XTK_GAIN * xtk))
  const commandedTrackTrue = mod360(legCourse - intercept)

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

  return { commandedTrackTrue, xtkNm: xtk, sequence, nextLegIdx: legIdx + 1 }
}

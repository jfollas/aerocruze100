import { describe, it, expect } from 'vitest'
import { PLANS, gpssGuidance } from './navplan.js'
import { FIX_XY, bearingToTrue } from './geo.js'

describe('flight plans', () => {
  it('LEYIR and WUDAT both feed UBAYA -> ZIMBO -> RW10', () => {
    expect(PLANS.LEYIR.map((w) => w.name)).toEqual(['LEYIR', 'UBAYA', 'ZIMBO', 'RW10'])
    expect(PLANS.WUDAT.map((w) => w.name)).toEqual(['WUDAT', 'UBAYA', 'ZIMBO', 'RW10'])
  })
})

describe('GPSS guidance', () => {
  // active leg 2 of the WUDAT plan = UBAYA -> ZIMBO (the level inbound leg)
  const plan = PLANS.WUDAT
  const legIdx = 2
  const A = FIX_XY.UBAYA
  const B = FIX_XY.ZIMBO
  const legCourse = bearingToTrue(A, B)

  it('on course commands ~the leg course', () => {
    const mid = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 }
    const g = gpssGuidance(plan, legIdx, mid, 90)
    expect(Math.abs(g.xtkNm)).toBeLessThan(0.01)
    expect(g.commandedTrackTrue).toBeCloseTo(legCourse, 1)
  })

  it('right of course yields +xtk and a left correction', () => {
    // the leg runs ~east; nudge the point south of the line (right of an
    // eastbound course)
    const mid = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 - 0.5 }
    const g = gpssGuidance(plan, legIdx, mid, 90)
    expect(g.xtkNm).toBeGreaterThan(0)
    // commanded track is turned left of the leg course (toward the line)
    expect(g.commandedTrackTrue).toBeLessThan(legCourse)
  })

  it('sequences when close to the downstream fix', () => {
    const nearB = { x: B.x - 0.1, y: B.y }
    const g = gpssGuidance(plan, legIdx, nearB, 90)
    expect(g.sequence).toBe(true)
    expect(g.nextLegIdx).toBe(3)
  })

  it('never sequences off the final leg (-> RW10)', () => {
    const finalIdx = 3
    const nearThr = { x: FIX_XY.RW10.x - 0.05, y: FIX_XY.RW10.y }
    const g = gpssGuidance(plan, finalIdx, nearThr, 90)
    expect(g.sequence).toBe(false)
  })

  it('turn-anticipation distance grows with groundspeed', () => {
    // place the aircraft 0.55 nm before UBAYA on the WUDAT->UBAYA leg so there is
    // a 90° course change ahead; the distance sits between the slow and fast
    // standard-rate turn-anticipation radii, so only the fast case sequences here.
    const slow = gpssGuidance(PLANS.WUDAT, 1, { x: FIX_XY.UBAYA.x, y: FIX_XY.UBAYA.y - 0.55 }, 60)
    const fast = gpssGuidance(PLANS.WUDAT, 1, { x: FIX_XY.UBAYA.x, y: FIX_XY.UBAYA.y - 0.55 }, 150)
    // not a strict assertion on both, but the fast case should sequence at this
    // distance while the slow one should not
    expect(fast.sequence).toBe(true)
    expect(slow.sequence).toBe(false)
  })
})

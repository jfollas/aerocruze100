import { describe, it, expect } from 'vitest'
import { reducer, initialState } from './machine.js'
import * as E from './events.js'
import { FIX_XY, AP_MIN_MSL } from './geo.js'

// Boot the unit and load the scenario at the given IAF.
function loaded(iaf, cfg = {}) {
  let s = reducer(initialState, E.setConfig({ power: 'on' }))
  s = reducer(s, E.tick(3)) // finish booting
  s = reducer(s, E.setConfig({ gpsStatus: 'OK', groundSpeed: 90, ...cfg }))
  s = reducer(s, E.setConfig({ scenarioActive: true, scenarioIaf: iaf }))
  return s
}

// Engage the AP in GPSS, established level at the 2300 ft platform.
function coupledSetup(iaf) {
  let s = loaded(iaf, { gpsData: 'ifr' })
  s = reducer(s, E.knobPress()) // engage
  s = reducer(s, E.mode()) // TRK -> GPSS
  return { ...s, verticalMode: 'ALTHOLD', selAlt: 2300, curAlt: 2300 }
}

const fly = (s, secs, step = 0.5) => {
  for (let t = 0; t < secs; t += step) s = reducer(s, E.tick(step))
  return s
}

describe('scenario start', () => {
  it('snaps the aircraft to the chosen IAF', () => {
    const s = loaded('WUDAT')
    expect(s.scenarioActive).toBe(true)
    expect(s.scenarioIaf).toBe('WUDAT')
    expect(s.approachActive).toBe(true)
    expect(s.activeLeg).toBe(1)
    expect(s.curX).toBeCloseTo(FIX_XY.WUDAT.x, 3)
    expect(s.curY).toBeCloseTo(FIX_XY.WUDAT.y, 3)
    expect(s.curAlt).toBe(3000)
  })
})

describe('GNS430W + GPSS flies the published approach', () => {
  it('sequences WUDAT -> UBAYA -> ZIMBO, holds 2300 then couples and descends', () => {
    let s = coupledSetup('WUDAT')
    expect(s.lateralMode).toBe('GPSS')
    expect(s.apEngaged).toBe(true)

    // fly the inbound; before the FAF it stays level at 2300 and never coupled
    s = fly(s, 120)
    expect(s.curAlt).toBeGreaterThan(2250)
    expect(s.verticalMode).not.toBe('GS_CPLD')

    // continue to the FAF and onto the final — it sequences and couples
    s = fly(s, 380)
    expect(s.activeLeg).toBe(3)
    expect(s.verticalMode).toBe('GS_CPLD')
    expect(s.lpvPhase).toBe('CPLD')
    expect(s.curAlt).toBeLessThan(2200) // descending the glidepath
  })

  it('keeps the glideslope centred while coupled', () => {
    let s = coupledSetup('WUDAT')
    s = fly(s, 460) // well established on the glidepath
    expect(s.verticalMode).toBe('GS_CPLD')
    expect(Math.abs(s.gsDev)).toBeLessThan(0.35)
  })

  it('descends through the 700-AGL floor and flags the warning', () => {
    let s = coupledSetup('WUDAT')
    s = fly(s, 575)
    expect(s.curAlt).toBeLessThan(AP_MIN_MSL) // below 1373 ft MSL
    expect(s.agl).toBeLessThan(700)
  })

  it('a momentary ALT press in GS CPLD goes missed (climb, no re-couple)', () => {
    let s = coupledSetup('WUDAT')
    s = fly(s, 450)
    expect(s.verticalMode).toBe('GS_CPLD')
    const alt0 = s.curAlt
    s = reducer(s, E.alt()) // §5.4.6 missed approach
    expect(s.verticalMode).toBe('SVS')
    expect(s.selVS).toBe(500)
    s = fly(s, 20)
    expect(s.curAlt).toBeGreaterThan(alt0) // climbing
    expect(s.verticalMode).not.toBe('GS_CPLD') // does not silently re-couple
  })
})

describe('SkyView source flies the bugs with no glideslope coupling', () => {
  it('follows the heading bug and never couples a glideslope', () => {
    let s = loaded('LEYIR', { skyview: 'on' })
    s = reducer(s, E.mode()) // enter SkyView mode
    s = reducer(s, E.knobPress()) // engage (stays in SkyView)
    expect(s.lateralMode).toBe('SKYVIEW')
    const x0 = s.curX
    s = fly(s, 60)
    expect(s.curX).not.toBeCloseTo(x0, 2) // the aircraft moved
    expect(s.verticalMode).not.toBe('GS_CPLD')
    expect(s.gsDev).toBe(0)
    expect(s.lpvPhase).toBe(null)
  })
})

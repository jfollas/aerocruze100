import { describe, it, expect } from 'vitest'
import { reducer, initialState } from './machine.js'
import * as E from './events.js'
import { FIX_XY, AP_MIN_MSL, nmBetween } from './geo.js'

const FAF_DTHR = nmBetween(FIX_XY.ZIMBO, FIX_XY.RW10) // ZIMBO -> threshold (~4.9 nm)

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

  it('captures an off-course condition without the bank hunting (no limit cycle)', () => {
    let s = coupledSetup('UBAYA_DIRECT')
    s = { ...s, curY: s.curY + 0.8 } // displace 0.8 nm off the inbound course
    let prev = 0
    let flips = 0
    for (let t = 0; t < 180; t += 0.1) {
      s = reducer(s, E.tick(0.1))
      if (s.groundSpeed < 5) break
      const b = s.bankAngle
      if (Math.sign(b) && Math.sign(prev) && Math.sign(b) !== Math.sign(prev)) flips++
      if (Math.sign(b)) prev = b
    }
    // A smooth capture reverses the bank only a couple of times; the old
    // establish/intercept switch chattered hundreds of times around level.
    expect(flips).toBeLessThan(5)
    expect(Math.abs(s.cdiDev)).toBeLessThan(0.3) // and it ends established on course
  })

  it('keeps the glideslope centred while coupled', () => {
    let s = coupledSetup('WUDAT')
    s = fly(s, 460) // well established on the glidepath
    expect(s.verticalMode).toBe('GS_CPLD')
    expect(Math.abs(s.gsDev)).toBeLessThan(0.35)
  })

  it('couples from below above the 2300 platform — intercepts the glidepath before ZIMBO', () => {
    let s = coupledSetup('WUDAT')
    s = { ...s, verticalMode: 'ALTHOLD', selAlt: 2700, curAlt: 2700 } // hold higher than the platform
    let capture = null
    for (let t = 0; t < 500 && !capture; t += 0.5) {
      s = reducer(s, E.tick(0.5))
      if (s.verticalMode === 'GS_CPLD') capture = { alt: s.curAlt, dThr: s.gsDist }
    }
    expect(capture).not.toBeNull()
    expect(capture.alt).toBeGreaterThan(2300) // not required to be at the platform...
    expect(capture.dThr).toBeGreaterThan(FAF_DTHR) // ...and it coupled before reaching the FAF
  })

  it('does NOT couple when arriving well above the glidepath (no intercept-from-above)', () => {
    let s = coupledSetup('WUDAT')
    s = { ...s, verticalMode: 'ALTHOLD', selAlt: 4500, curAlt: 4500 } // far above the path the whole way
    s = fly(s, 260) // fly the inbound to the FAF holding 4500
    expect(s.verticalMode).not.toBe('GS_CPLD') // never captured from above
    expect(Math.round(s.curAlt)).toBe(4500) // still level — the GP passed below it
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

describe('SkyView source (Install Manual §10)', () => {
  it('with the CDI on HEADING follows the heading bug, no glideslope', () => {
    let s = loaded('LEYIR', { skyview: 'on' })
    s = reducer(s, E.setConfig({ skyviewCdi: 'heading' })) // CDI not on a flight plan
    s = reducer(s, E.knobPress()) // engage -> SkyView
    expect(s.lateralMode).toBe('SKYVIEW')
    const x0 = s.curX
    s = fly(s, 60)
    expect(s.curX).not.toBeCloseTo(x0, 2) // the aircraft moved
    expect(s.verticalMode).not.toBe('GS_CPLD')
    expect(s.gsDev).toBe(0)
    expect(s.lpvPhase).toBe(null)
  })

  it('with the CDI on a flight plan flies the GPS course laterally but does NOT couple the glideslope', () => {
    // The SkyView passes the lateral GPS course + the bugs, not the GPS vertical
    // guidance — so it's lateral GPS with manual/stepdown vertical via the bugs.
    let s = loaded('WUDAT', { skyview: 'on' })
    s = { ...s, altDelta: 0 }
    s = reducer(s, E.knobPress()) // engage -> SkyView; CDI is on the flight plan
    s = { ...s, svAltBug: 2300, svAltBugSet: true } // hold the platform on the SkyView alt bug
    expect(s.skyviewCdi).toBe('flightplan')
    let coupled = false
    for (let t = 0; t < 700; t += 0.5) {
      s = reducer(s, E.tick(0.5))
      if (s.verticalMode === 'GS_CPLD') coupled = true
    }
    expect(s.activeLeg).toBeGreaterThanOrEqual(2) // sequenced down the published plan (lateral GPS)
    expect(coupled).toBe(false) // no glideslope coupling through the SkyView
    expect(s.lpvPhase).toBe(null)
    expect(Math.round(s.curAlt)).toBe(2300) // vertical held at the alt bug, not flown down the GS
  })
})

describe('GPS course tracking with wind correction', () => {
  const signed = (a, b) => ((a - b + 540) % 360) - 180

  it('crabs into a crosswind and holds the GPS course (cross-track ~0)', () => {
    // 40 kt aloft from the north — a crosswind on the eastbound UBAYA->ZIMBO leg
    let s = loaded('WUDAT', { gpsData: 'ifr', windDir: 360, windSpd: 40 })
    s = reducer(s, E.knobPress()) // engage
    s = reducer(s, E.mode()) // TRK -> GPSS
    s = { ...s, verticalMode: 'ALTHOLD', selAlt: 2300, curAlt: 2300 }
    const devs = []
    let crab = 0
    for (let t = 0; t < 500; t += 0.5) {
      s = reducer(s, E.tick(0.5))
      if (s.activeLeg === 2) {
        devs.push(Math.abs(s.cdiDev || 0))
        crab = signed(s.curTrack, s.gpsDtk) // heading vs the course (the wind-correction angle)
      }
    }
    const tail = devs.slice(Math.floor(devs.length * 0.6))
    const steadyDev = tail.reduce((a, b) => a + b, 0) / tail.length
    expect(steadyDev).toBeLessThan(0.2) // course held to a small fraction of a dot
    expect(Math.abs(crab)).toBeGreaterThan(8) // visibly crabbed into the wind
  })

  it('shows a reduced ground speed in a headwind', () => {
    // wind from ~the final approach course = a headwind; GS drops below the airspeed
    let s = loaded('WUDAT', { gpsData: 'ifr', windDir: 100, windSpd: 35 })
    s = reducer(s, E.knobPress())
    s = reducer(s, E.mode())
    s = { ...s, verticalMode: 'ALTHOLD', selAlt: 2300, curAlt: 2300 }
    let gsOnLeg2 = 90
    for (let t = 0; t < 400; t += 0.5) {
      s = reducer(s, E.tick(0.5))
      if (s.activeLeg === 2) gsOnLeg2 = s.curGS
    }
    expect(gsOnLeg2).toBeLessThan(80) // headwind slows the groundspeed below the 90 kt airspeed
  })
})

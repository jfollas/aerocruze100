import { describe, it, expect } from 'vitest'
import { reducer, initialState, lateralCycle } from './machine.js'
import { deriveDisplay } from './screens.js'
import * as E from './events.js'

// Apply a list of events to a starting state.
const run = (s, ...events) => events.reduce((acc, e) => reducer(acc, e), s)

// A fully powered, GPS-OK, moving aircraft (disengaged on the home screen).
function poweredOn(overrides = {}) {
  let s = reducer(initialState, E.setConfig({ power: 'on' }))
  s = reducer(s, E.tick(3)) // finish boot
  s = reducer(s, E.setConfig({ gpsStatus: 'OK', groundSpeed: 120, curTrack: 200, curVS: 0, curAlt: 3000, ...overrides }))
  return s
}

describe('power up', () => {
  it('boots then shows AP OFF on the normal screen', () => {
    let s = reducer(initialState, E.setConfig({ power: 'on' }))
    expect(s.power).toBe('booting')
    expect(deriveDisplay(s).full).toEqual(['VIZION 380 VZ.5'])
    s = reducer(s, E.tick(3))
    expect(s.power).toBe('on')
    expect(s.apEngaged).toBe(false)
    expect(deriveDisplay(s).bottomLeft.apOff).toBe(true)
  })

  it('a knob press during boot opens the contrast menu (§4.4)', () => {
    let s = reducer(initialState, E.setConfig({ power: 'on' }))
    s = reducer(s, E.knobPress())
    expect(s.screen).toBe('CONTRAST')
    s = reducer(s, E.knobPress())
    expect(s.screen).toBe('MIN_BKLT')
    s = reducer(s, E.knobPress())
    expect(s.screen).toBe('SETUP')
    s = reducer(s, E.knobPress())
    expect(s.screen).toBe('NORMAL')
  })
})

describe('engage / disengage (§5.2)', () => {
  it('knob press engages, syncing track and VS into TRK + SVS', () => {
    const s = reducer(poweredOn({ curTrack: 200, curVS: 1000 }), E.knobPress())
    expect(s.apEngaged).toBe(true)
    expect(s.lateralMode).toBe('TRK')
    expect(s.verticalMode).toBe('SVS')
    expect(s.selTrack).toBe(200)
    expect(s.selVS).toBe(1000)
  })

  it('knob hold disengages and shows AP OFF', () => {
    let s = reducer(poweredOn(), E.knobPress())
    s = reducer(s, E.knobHold())
    expect(s.apEngaged).toBe(false)
    expect(deriveDisplay(s).bottomLeft.apOff).toBe(true)
  })
})

describe('lateral modes (§5.3)', () => {
  it('MODE cycles TRK -> GPS NAV -> TRK with a portable GPS', () => {
    let s = reducer(poweredOn({ gpsData: 'portable' }), E.knobPress())
    expect(lateralCycle(s)).toEqual(['TRK', 'GPSNAV'])
    s = reducer(s, E.mode())
    expect(s.lateralMode).toBe('GPSNAV')
    s = reducer(s, E.mode())
    expect(s.lateralMode).toBe('TRK')
  })

  it('skips GPS NAV when an IFR (ARINC) GPS feeds GPSS (§5.3.3)', () => {
    let s = reducer(poweredOn({ gpsData: 'ifr' }), E.knobPress())
    expect(lateralCycle(s)).toEqual(['TRK', 'GPSS'])
    s = reducer(s, E.mode())
    expect(s.lateralMode).toBe('GPSS')
  })

  it('knob rotation selects track in 5° / 1° steps', () => {
    let s = reducer(poweredOn({ curTrack: 200 }), E.knobPress())
    s = reducer(s, E.knobCw())
    expect(s.selTrack).toBe(205)
    s = reducer(s, E.knobCcw(true))
    expect(s.selTrack).toBe(204)
  })
})

describe('altitude select & sync (§5.1, §5.4.3)', () => {
  it('ALT once -> SEL ALT, ALT again -> ALT SYNC; knob confirms baro', () => {
    let s = reducer(poweredOn(), E.knobPress())
    s = reducer(s, E.alt())
    expect(s.screen).toBe('SEL_ALT')
    s = reducer(s, E.alt())
    expect(s.screen).toBe('ALT_SYNC')
    const baro0 = s.baro
    s = reducer(s, E.knobCw())
    expect(s.baro).toBe(baro0 + 10)
    s = reducer(s, E.knobPress())
    expect(s.screen).toBe('NORMAL')
  })

  it('selects an altitude and VS, transitions, then captures into ALT HOLD', () => {
    let s = reducer(poweredOn({ curAlt: 3000 }), E.knobPress())
    s = reducer(s, E.alt()) // SEL_ALT, cursor altSel
    s = run(s, E.knobCw(), E.knobCw()) // +1000 -> 4000
    expect(s.selAlt).toBe(4000)
    s = reducer(s, E.knobPress()) // cursor -> vs
    expect(s.cursor).toBe('vs')
    s = reducer(s, E.knobPress()) // confirm -> SEL transition
    expect(s.verticalMode).toBe('SEL')
    expect(deriveDisplay(s).topRight).toEqual({ label: 'SEL', value: '4000' })
    // fly up to the target
    for (let i = 0; i < 600 && s.verticalMode === 'SEL'; i++) s = reducer(s, E.tick(0.5))
    expect(s.verticalMode).toBe('ALTHOLD')
  })

  it('a knob press in ALT HOLD returns to SVS-zero (§5.4.1)', () => {
    let s = poweredOn({ curAlt: 4000 })
    s = reducer(s, E.knobPress()) // engage
    s = { ...s, verticalMode: 'ALTHOLD' }
    s = reducer(s, E.knobPress())
    expect(s.verticalMode).toBe('SVS')
    expect(s.selVS).toBe(0)
  })
})

describe('altitude pre-select while disengaged (§5.4.4)', () => {
  it('ALT -> select alt -> knob arms; engaging climbs in SEL', () => {
    let s = poweredOn({ curAlt: 1500, curVS: 0 })
    s = reducer(s, E.alt()) // SEL_ALT, cursor altSel
    s = run(s, ...Array(4).fill(E.knobCw())) // +2000 -> selAlt 5000
    expect(s.selAlt).toBe(5000)
    s = reducer(s, E.knobPress()) // arm
    expect(s.preselectArmed).toBe(true)
    expect(s.apEngaged).toBe(false)
    s = reducer(s, E.knobPress()) // engage
    expect(s.apEngaged).toBe(true)
    expect(s.verticalMode).toBe('SEL')
    expect(s.selVS).toBe(500) // synced to 500 fpm when current VS < 400 (§5.4.4)
  })
})

describe('vertical approach (§5.4.5, §5.4.6)', () => {
  it('GPSS + approach + zero VS sequences GS ARM -> GS CPLD', () => {
    let s = poweredOn({ gpsData: 'ifr', approachActive: true })
    s = reducer(s, E.knobPress()) // engage
    s = reducer(s, E.mode()) // -> GPSS
    expect(s.lateralMode).toBe('GPSS')
    s = { ...s, selVS: 0, verticalMode: 'SVS' }
    s = reducer(s, E.tick(0.1))
    expect(s.verticalMode).toBe('GS_ARM')
    for (let i = 0; i < 60 && s.verticalMode === 'GS_ARM'; i++) s = reducer(s, E.tick(0.5))
    expect(s.verticalMode).toBe('GS_CPLD')
  })

  it('ALT in GS CPLD initiates a missed approach climb (§5.4.6)', () => {
    let s = poweredOn({ gpsData: 'ifr', approachActive: true })
    s = reducer(s, E.knobPress())
    s = reducer(s, E.mode())
    s = { ...s, verticalMode: 'GS_CPLD' }
    s = reducer(s, E.alt())
    expect(s.verticalMode).toBe('SVS')
    expect(s.selVS).toBe(500)
    expect(s.lateralMode).toBe('GPSS')
  })
})

describe('safety features', () => {
  it('AP LVL engages emergency level (BANK 0°, SYS 0) and reverts to TRK (§8.1)', () => {
    let s = reducer(poweredOn({ curTrack: 90 }), E.apLvl())
    expect(s.emergencyLevel).toBe(true)
    expect(s.verticalMode).toBe('SVS')
    expect(s.selVS).toBe(0)
    expect(deriveDisplay(s).topLeft.header).toBe('BANK')
    for (let i = 0; i < 40; i++) s = reducer(s, E.tick(0.5))
    expect(s.emergencyLevel).toBe(false)
    expect(s.lateralMode).toBe('TRK')
  })

  it('a sensor error disengages and latches a flashing warning (§8.4)', () => {
    let s = reducer(poweredOn(), E.knobPress())
    s = reducer(s, E.setConfig({ warning: 'SENSOR' }))
    expect(s.apEngaged).toBe(false)
    const d = deriveDisplay(s)
    expect(d.full).toEqual(['SENSOR', 'ERROR'])
    expect(d.flashing).toBe(true)
  })

  it('MODE toggles AEP arming while disengaged (§8.2)', () => {
    let s = poweredOn()
    expect(s.aep).toBe('off')
    s = reducer(s, E.mode())
    expect(s.aep).toBe('stby')
    s = reducer(s, E.mode())
    expect(s.aep).toBe('off')
  })

  it('engaged with no GPS shows BANK / gyro backup (§4.1.2, §8.3)', () => {
    let s = poweredOn({ gpsStatus: 'NOGPS', groundSpeed: 0 })
    s = reducer(s, E.knobPress())
    s = reducer(s, E.tick(0.1))
    expect(s.gyroMode).toBe(true)
    expect(deriveDisplay(s).topLeft.header).toBe('BANK')
  })
})

describe('CWS (§5.4.7)', () => {
  it('press shows CWS, release captures the new track and VS', () => {
    let s = reducer(poweredOn({ curTrack: 200 }), E.knobPress())
    s = reducer(s, E.cwsPress())
    expect(s.cwsHeld).toBe(true)
    expect(deriveDisplay(s).bottomLeft.text).toBe('CWS AP')
    s = { ...s, curTrack: 250, curVS: 600 }
    s = reducer(s, E.cwsRelease())
    expect(s.cwsHeld).toBe(false)
    expect(s.selTrack).toBe(250)
    expect(s.selVS).toBe(600)
  })
})

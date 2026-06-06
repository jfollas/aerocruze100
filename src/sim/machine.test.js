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
    expect(deriveDisplay(s).full).toEqual(['AEROCRUZE 100'])
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
    const delta0 = s.altDelta
    s = reducer(s, E.knobCw())
    expect(s.altDelta).toBe(delta0 + 10)
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
    expect(deriveDisplay(s).topRight).toEqual({ label: 'SEL', alt: 4000 })
    // fly up to the target
    for (let i = 0; i < 600 && s.verticalMode === 'SEL'; i++) s = reducer(s, E.tick(0.5))
    expect(s.verticalMode).toBe('ALTHOLD')
  })

  it('ALT then KNOB (no rotate) holds the current altitude (§5.4.2)', () => {
    // altimeter synced (no AP/PFD offset) so the capture is the actual altitude
    let s = reducer({ ...poweredOn({ curAlt: 5230 }), altDelta: 0 }, E.knobPress())
    expect(s.apEngaged).toBe(true)
    s = reducer(s, E.alt()) // SEL_ALT, cursor altSel
    s = reducer(s, E.knobPress()) // no rotate -> ALT HOLD
    expect(s.verticalMode).toBe('ALTHOLD')
    expect(s.selAlt).toBe(5200) // nearest 100 ft
  })

  it('a knob press in ALT HOLD returns to SVS-zero (§5.4.1)', () => {
    let s = poweredOn({ curAlt: 4000 })
    s = reducer(s, E.knobPress()) // engage
    s = { ...s, verticalMode: 'ALTHOLD' }
    s = reducer(s, E.knobPress())
    expect(s.verticalMode).toBe('SVS')
    expect(s.selVS).toBe(0)
  })

  it('an un-synced altimeter offsets the captured altitude (PFD reads AP + error)', () => {
    // AP altimeter reads 200 ft BELOW the actual/PFD altitude (altDelta = -200);
    // preselect 2300 -> the AP flies its reading down to 2300, so the PFD (actual)
    // settles at 2300 + 200 = 2500.
    let s = poweredOn({ curAlt: 4000, curVS: 0 })
    s = reducer(s, E.knobPress()) // engage
    s = { ...s, altDelta: -200, verticalMode: 'SEL', selAlt: 2300, selVS: -500 }
    for (let i = 0; i < 1200 && s.verticalMode === 'SEL'; i++) s = reducer(s, E.tick(0.5))
    expect(s.verticalMode).toBe('ALTHOLD')
    expect(Math.round(s.curAlt)).toBe(2500) // PFD/actual = selAlt - altDelta
  })
})

describe('altitude pre-select while disengaged (§5.4.4)', () => {
  it('ALT -> select alt -> knob press engages directly into the climb (Fig 5.4.4a)', () => {
    let s = poweredOn({ curAlt: 1500, curVS: 0 })
    s = reducer(s, E.alt()) // SEL_ALT, cursor altSel
    s = run(s, ...Array(4).fill(E.knobCw())) // +2000 -> selAlt 5000
    expect(s.selAlt).toBe(5000)
    s = reducer(s, E.knobPress()) // engage straight into the pre-select climb
    expect(s.apEngaged).toBe(true)
    expect(s.screen).toBe('NORMAL')
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
  it('AP LVL engages emergency level (BANK, SVS) and reverts to TRK (§8.1)', () => {
    let s = reducer(poweredOn({ curTrack: 90 }), E.apLvl())
    expect(s.emergencyLevel).toBe(true)
    expect(s.verticalMode).toBe('SVS')
    expect(s.selVS).toBe(0)
    const d = deriveDisplay(s)
    expect(d.elvl.vert).toEqual({ label: 'SVS', value: '0', arrow: '' })
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

  it('AEP defaults to standby; MODE toggles it off/standby while disengaged (§8.2)', () => {
    let s = poweredOn()
    expect(s.aep).toBe('stby') // standby by default / after power cycle
    s = reducer(s, E.mode())
    expect(s.aep).toBe('off')
    s = reducer(s, E.mode())
    expect(s.aep).toBe('stby')
  })

  it('AEP returns to standby after a power cycle (§8.2)', () => {
    let s = reducer(poweredOn(), E.mode()) // turn AEP off
    expect(s.aep).toBe('off')
    s = reducer(s, E.setConfig({ power: 'off' }))
    s = reducer(s, E.setConfig({ power: 'on' }))
    s = reducer(s, E.tick(3))
    expect(s.aep).toBe('stby')
  })

  it('engaged with no GPS shows BANK / gyro backup (§4.1.2, §8.3)', () => {
    let s = poweredOn({ gpsStatus: 'NOGPS', groundSpeed: 0 })
    s = reducer(s, E.knobPress())
    s = reducer(s, E.tick(0.1))
    expect(s.gyroMode).toBe(true)
    // gyro backup uses the shared BANK + SVS (elvl) layout
    const d = deriveDisplay(s)
    expect(d.elvl).toBeTruthy()
    expect(d.elvl.bank).toContain('°')
  })

  it('in gyro backup, the knob adjusts bank, then SVS after a knob press', () => {
    let s = poweredOn({ gpsStatus: 'NOGPS', groundSpeed: 0 })
    s = reducer(s, E.knobPress()) // engage -> gyro, cursor on bank
    s = reducer(s, E.tick(0.1))
    expect(s.cursor).toBe('track')
    s = reducer(s, E.knobCw())
    expect(s.selBank).toBe(1) // rotating adjusts bank
    s = reducer(s, E.knobPress()) // move cursor to SVS
    expect(s.cursor).toBe('vs')
    const vs0 = s.selVS
    s = reducer(s, E.knobCw())
    expect(s.selVS).toBe(vs0 + 100) // now rotating adjusts SVS
    expect(s.selBank).toBe(1) // bank unchanged
  })
})

describe('Dynon SkyView mode (Install Manual §10)', () => {
  it('MODE enters SkyView mode, grabbing the SkyView bugs', () => {
    let s = poweredOn({ skyview: 'on', svHeadingBug: 284, svAltBug: 3500, svVsBug: 500, curAlt: 1500 })
    s = reducer(s, E.knobPress()) // engage
    s = reducer(s, E.mode()) // enter SkyView
    expect(s.lateralMode).toBe('SKYVIEW')
    expect(s.selTrack).toBe(284)
    expect(s.selAlt).toBe(3500)
    expect(s.verticalMode).toBe('SEL') // alt bug above current -> transition
    const d = deriveDisplay(s)
    expect(d.topLeft.header).toBe('SKYVIEW')
    expect(d.bottomLeft).toEqual({ label: 'SEL', value: '284' })
    expect(d.topRight).toEqual({ label: 'ALT', alt: 3500 })
  })

  it('shows GPS bottom-left when the SkyView CDI follows a flight plan', () => {
    let s = poweredOn({ skyview: 'on', skyviewCdi: 'flightplan' })
    s = reducer(s, E.knobPress())
    s = reducer(s, E.mode())
    expect(deriveDisplay(s).bottomLeft).toEqual({ text: 'GPS' })
  })

  it('the knob does nothing in SkyView mode (commands come from SkyView)', () => {
    let s = poweredOn({ skyview: 'on', svHeadingBug: 100 })
    s = reducer(s, E.knobPress())
    s = reducer(s, E.mode())
    const before = s.selTrack
    s = reducer(s, E.knobCw())
    expect(s.selTrack).toBe(before)
  })

  it('MODE again exits SkyView and syncs to current track and VS (§10.2 step 5)', () => {
    let s = poweredOn({ skyview: 'on', curTrack: 160, curVS: 0 })
    s = reducer(s, E.knobPress())
    s = reducer(s, E.mode()) // enter
    s = reducer(s, E.mode()) // exit
    expect(s.lateralMode).toBe('TRK')
    expect(s.verticalMode).toBe('SVS')
    expect(s.selTrack).toBe(160)
    expect(deriveDisplay(s).topLeft.header).toBe('TRK')
  })

  it('follows the VS bug when no altitude bug is set', () => {
    let s = poweredOn({ skyview: 'on', svAltBugSet: false, svVsBug: 700 })
    s = reducer(s, E.knobPress())
    s = reducer(s, E.mode())
    s = reducer(s, E.tick(0.1))
    expect(s.verticalMode).toBe('SVS')
    expect(s.selVS).toBe(700)
    expect(deriveDisplay(s).topRight).toBeUndefined() // no ALT bug shown
  })

  it('can enter SkyView while disengaged and stay in it when engaged (§10.2)', () => {
    let s = poweredOn({ skyview: 'on', svHeadingBug: 200 })
    s = reducer(s, E.mode()) // enter SkyView while disengaged
    expect(s.lateralMode).toBe('SKYVIEW')
    expect(s.apEngaged).toBe(false)
    s = reducer(s, E.knobPress()) // engage
    expect(s.apEngaged).toBe(true)
    expect(s.lateralMode).toBe('SKYVIEW') // stays in SkyView, not TRK
    expect(s.selTrack).toBe(200)
  })

  it('drops out of SkyView if the signal is lost', () => {
    let s = poweredOn({ skyview: 'on' })
    s = reducer(s, E.knobPress())
    s = reducer(s, E.mode())
    expect(s.lateralMode).toBe('SKYVIEW')
    s = reducer(s, E.setConfig({ skyview: 'off' }))
    s = reducer(s, E.tick(0.1))
    expect(s.lateralMode).toBe('TRK')
  })
})

describe('CWS (§5.2.2, §5.4.7)', () => {
  it('a tap disengages the autopilot (§5.2.2)', () => {
    let s = reducer(poweredOn(), E.knobPress())
    expect(s.apEngaged).toBe(true)
    s = reducer(s, E.cwsTap())
    expect(s.apEngaged).toBe(false)
  })

  it('hold shows CWS, release captures the new track and VS (§5.4.7)', () => {
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

describe('PFD flight model (airspeed & pitch)', () => {
  it('airspeed rises toward cruise when flying, pitch tracks VS sign', () => {
    let s = poweredOn({ groundSpeed: 120, curIAS: 0, curVS: 0 })
    s = reducer(s, E.knobPress()) // engage
    s = reducer(s, E.alt())
    s = run(s, E.knobCw(), E.knobCw(), E.knobCw(), E.knobCw()) // climb target above current
    s = reducer(s, E.knobPress()) // cursor -> vs
    s = reducer(s, E.knobPress()) // confirm -> SEL climb
    for (let i = 0; i < 40; i++) s = reducer(s, E.tick(0.5))
    expect(s.curIAS).toBeGreaterThan(80) // settled toward cruise
    expect(s.pitch).toBeGreaterThan(1) // nose up while climbing
  })

  it('airspeed falls to zero when not flying', () => {
    let s = poweredOn({ groundSpeed: 0, curIAS: 100 })
    for (let i = 0; i < 40; i++) s = reducer(s, E.tick(0.5))
    expect(s.curIAS).toBeLessThan(20)
  })
})

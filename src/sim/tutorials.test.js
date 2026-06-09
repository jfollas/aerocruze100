import { describe, it, expect } from 'vitest'
import { reducer, initialState } from './machine.js'
import * as E from './events.js'
import { LESSONS, CONTROL_IDS, lessonById } from './tutorials.js'

// A tiny harness mirroring App's reducer + actions, so lessons can be "played"
// exactly as the UI would drive them (init/setup call actions; the user's button
// presses and the clock advance the same reducer).
function makeSim() {
  let s = initialState
  const apply = (e) => {
    s = reducer(s, e)
  }
  const actions = {
    mode: () => apply(E.mode()),
    alt: () => apply(E.alt()),
    rotate: (dir, fine) => apply(dir > 0 ? E.knobCw(fine) : E.knobCcw(fine)),
    knobPress: () => apply(E.knobPress()),
    knobHold: () => apply(E.knobHold()),
    cwsTap: () => apply(E.cwsTap()),
    cwsPress: () => apply(E.cwsPress()),
    cwsRelease: () => apply(E.cwsRelease()),
    apLvl: () => apply(E.apLvl()),
    setConfig: (patch) => apply(E.setConfig(patch)),
  }
  return {
    actions,
    get: () => s,
    tick: (secs, step = 0.5) => {
      for (let t = 0; t < secs; t += step) apply(E.tick(step))
    },
    tickUntil: (pred, maxSecs = 1200, step = 0.5) => {
      for (let t = 0; t < maxSecs && !pred(s); t += step) apply(E.tick(step))
      return s
    },
  }
}

// dial the ALT SYNC offset to zero (10 ft per coarse detent), then confirm
function altSync(sim) {
  sim.actions.alt() // -> SEL_ALT
  sim.actions.alt() // -> ALT_SYNC
  let guard = 0
  while (Math.abs(sim.get().altDelta) >= 10 && guard++ < 50) sim.actions.rotate(-1)
  sim.actions.knobPress() // confirm -> NORMAL
}

describe('tutorial lessons are well-formed', () => {
  it('every lesson has the required shape', () => {
    expect(LESSONS.length).toBeGreaterThanOrEqual(4)
    for (const l of LESSONS) {
      expect(typeof l.id).toBe('string')
      expect(typeof l.title).toBe('string')
      expect(typeof l.blurb).toBe('string')
      expect(typeof l.init).toBe('function')
      expect(Array.isArray(l.steps) && l.steps.length > 0).toBe(true)
    }
    const ids = LESSONS.map((l) => l.id)
    expect(new Set(ids).size).toBe(ids.length) // unique ids
  })

  it('every step is well-formed and highlights a known control', () => {
    for (const l of LESSONS) {
      for (const step of l.steps) {
        expect(typeof step.prompt).toBe('string')
        if (typeof step.highlight === 'function') {
          // a state-driven highlight must always resolve to a known control (or null)
          for (const screen of ['NORMAL', 'SEL_ALT', 'ALT_SYNC']) {
            const h = step.highlight({ ...initialState, screen })
            expect(h === null || CONTROL_IDS.includes(h)).toBe(true)
          }
        } else {
          expect(step.highlight === null || CONTROL_IDS.includes(step.highlight)).toBe(true)
        }
        if (step.check) expect(typeof step.check).toBe('function')
        if (step.setup) expect(typeof step.setup).toBe('function')
        if (step.accel !== undefined) {
          // a clock-acceleration tag is true or a multiplier > 1, and only on
          // clock-running (pause:false) waits
          expect(step.accel === true || (typeof step.accel === 'number' && step.accel > 1)).toBe(true)
          expect(step.pause).toBe(false)
        }
      }
    }
  })

  it('check predicates are pure (no throw, no mutation) on the initial state', () => {
    const snap = JSON.stringify(initialState)
    for (const l of LESSONS) {
      for (const step of l.steps) {
        if (!step.check) continue
        const r = step.check(initialState)
        expect(typeof r).toBe('boolean')
      }
    }
    expect(JSON.stringify(initialState)).toBe(snap)
  })

  it('lessonById resolves and rejects', () => {
    expect(lessonById('startup')).toBe(LESSONS[0])
    expect(lessonById('nope')).toBe(null)
  })

  it("each lesson's first action step is not already satisfied after init", () => {
    for (const l of LESSONS) {
      const sim = makeSim()
      l.init(sim.actions)
      const first = l.steps.find((st) => st.check && !st.allowPreSatisfied)
      // the first real action step should require the user to do something
      expect(first.check(sim.get())).toBe(false)
    }
  })
})

describe('Lesson 1 — Startup & basic modes (full playthrough)', () => {
  it('each step becomes satisfied in order', () => {
    const sim = makeSim()
    const L = lessonById('startup')
    const C = L.steps.map((s) => s.id)
    L.init(sim.actions) // powered OFF, ready

    const at = (id) => L.steps[C.indexOf(id)]
    const done = (id) => at(id).check(sim.get())

    expect(done('power-on')).toBe(false)
    sim.actions.setConfig({ power: 'on' })
    expect(done('power-on')).toBe(true)

    sim.tick(3.5)
    expect(sim.get().power).toBe('on') // boot finished (notice step advances via Next, not a check)

    expect(done('altsync-open')).toBe(false)
    sim.actions.alt()
    sim.actions.alt()
    expect(done('altsync-open')).toBe(true)

    expect(done('altsync-dial')).toBe(false)
    let g = 0
    while (Math.abs(sim.get().altDelta) >= 10 && g++ < 50) sim.actions.rotate(-1)
    expect(done('altsync-dial')).toBe(false) // synced but still on the ALT SYNC screen
    sim.actions.knobPress() // confirm -> NORMAL
    expect(done('altsync-dial')).toBe(true)

    expect(done('engage')).toBe(false)
    sim.actions.knobPress()
    expect(done('engage')).toBe(true)

    expect(done('set-heading')).toBe(false)
    for (let i = 0; i < 4; i++) sim.actions.rotate(1) // selTrack 200 -> 220
    expect(done('set-heading')).toBe(true)

    sim.tickUntil((s) => at('watch-turn').check(s), 60)
    expect(done('watch-turn')).toBe(true)

    expect(done('alt-hold')).toBe(false)
    sim.actions.alt() // -> SEL_ALT
    sim.actions.knobPress() // no turn -> ALT HOLD
    expect(done('alt-hold')).toBe(true)

    expect(done('sel-alt')).toBe(false)
    sim.actions.alt() // -> SEL_ALT
    sim.actions.rotate(1)
    sim.actions.rotate(1) // selAlt +1000
    sim.actions.knobPress() // cursor -> vs
    sim.actions.rotate(1) // a climb rate
    sim.actions.knobPress() // confirm -> SEL
    expect(done('sel-alt')).toBe(true)

    sim.tickUntil((s) => at('watch-capture').check(s), 300)
    expect(done('watch-capture')).toBe(true)
  })
})

describe('Lesson 2 — Coupled approach + missed (playthrough)', () => {
  it('flies the plan, couples the glideslope, and goes missed', () => {
    const sim = makeSim()
    const L = lessonById('approach')
    const C = L.steps.map((s) => s.id)
    const at = (id) => L.steps[C.indexOf(id)]
    const done = (id) => at(id).check(sim.get())

    L.init(sim.actions) // powered on (booting), NAV none, gs 90
    sim.tick(3.5)
    expect(sim.get().power).toBe('on') // boot finished

    sim.actions.setConfig({ gpsData: 'ifr', arinc: 'none', skyview: 'off' })
    expect(done('src-430w')).toBe(true)

    altSync(sim)
    expect(done('altsync-dial')).toBe(true)

    sim.actions.setConfig({ scenarioActive: true, scenarioIaf: 'WUDAT' })
    expect(done('start-iaf')).toBe(true)
    expect(sim.get().approachActive).toBe(true) // selecting the IAF auto-arms the approach

    sim.actions.knobPress() // engage
    expect(done('engage')).toBe(true)

    sim.actions.mode() // TRK -> GPSS (re-introduces the 150 ft mismatch)
    expect(done('gpss')).toBe(true)
    expect(sim.get().altDelta).not.toBe(0)

    altSync(sim)
    expect(done('resync')).toBe(true)

    // SEL down to the 2300 platform with a descent rate
    sim.actions.alt()
    for (let i = 0; i < 7; i++) sim.actions.rotate(-1, true) // 3000 -> 2300 (fine, 100/detent)
    sim.actions.knobPress() // cursor -> vs
    for (let i = 0; i < 7; i++) sim.actions.rotate(-1) // -700 fpm
    sim.actions.knobPress() // confirm -> SEL
    expect(done('platform')).toBe(true)

    sim.tickUntil((s) => at('level-platform').check(s), 400)
    expect(done('level-platform')).toBe(true)

    sim.tickUntil((s) => s.verticalMode === 'GS_CPLD', 800)
    expect(done('couple')).toBe(true)

    sim.tickUntil((s) => s.agl != null && s.agl <= 700, 600)
    expect(done('to-mins')).toBe(true)

    expect(done('go-missed')).toBe(false)
    sim.actions.alt() // missed approach from GS_CPLD
    expect(done('go-missed')).toBe(true)

    // climb-out is a read-then-Next notice (no check); the SVS climb is underway
    sim.tickUntil((s) => s.agl != null && s.agl > 1000, 400)
    expect(sim.get().verticalMode).toBe('SVS')
    expect(sim.get().curVS).toBeGreaterThan(0)
  })
})

describe('Lesson 3 — SkyView & nav variations (playthrough)', () => {
  it('follows the bugs, flies the GPS course, holds in lieu, and crabs in wind', () => {
    const sim = makeSim()
    const L = lessonById('skyview')
    const C = L.steps.map((s) => s.id)
    const at = (id) => L.steps[C.indexOf(id)]
    const done = (id) => at(id).check(sim.get())
    const run = (id) => at(id).setup?.(sim.actions)

    L.init(sim.actions)
    sim.tick(3.5)
    expect(sim.get().power).toBe('on') // boot finished

    sim.actions.setConfig({ gpsData: 'none', arinc: 'none', skyview: 'on' })
    expect(done('src-skyview')).toBe(true)

    altSync(sim)
    expect(done('altsync-dial')).toBe(true)

    sim.actions.setConfig({ svHeadingBug: 200 }) // SkyView HDG knob
    expect(done('hdg-bug')).toBe(true)

    sim.actions.setConfig({ svAltBug: 3300, svAltBugSet: true }) // a few hundred ft above
    expect(done('alt-bug')).toBe(true)

    run('vs-bug') // the step sets the VS bug for the user (no SkyView VS dial)
    expect(sim.get().svVsBug).toBe(500)

    sim.actions.mode() // MODE enters SkyView mode AND engages (no separate knob press)
    expect(done('enter-mode')).toBe(true)
    expect(sim.get().apEngaged).toBe(true)

    sim.tickUntil((s) => at('althold').check(s), 600) // climbs to the bug, captures ALT HOLD
    expect(done('althold')).toBe(true)

    sim.actions.setConfig({ skyviewCdi: 'flightplan' })
    expect(done('cdi-gps')).toBe(true)

    sim.actions.setConfig({ scenarioActive: true, scenarioIaf: 'UBAYA_TEARDROP' })
    expect(done('ubaya')).toBe(true)

    sim.tickUntil((s) => at('watch-entry').check(s), 600) // fly the teardrop, established inbound
    expect(done('watch-entry')).toBe(true)

    sim.actions.setConfig({ svAltBug: 2300 }) // lower the bug to step down
    expect(done('stepdown')).toBe(true)

    sim.tickUntil((s) => at('watch-descent').check(s), 600) // descend and level at 2300
    expect(done('watch-descent')).toBe(true)

    run('crab') // the step's setup sets the crosswind for the user (read-then-Next notice)
    expect(sim.get().windSpd).toBeGreaterThan(10)
    const crab = (s) => Math.abs(((s.curGT - s.curTrack + 540) % 360) - 180)
    sim.tickUntil((s) => crab(s) >= 5, 600) // the crab develops for the user to watch
    expect(crab(sim.get())).toBeGreaterThanOrEqual(5)

    sim.actions.mode() // MODE exits SkyView mode -> TRK, syncs track & VS
    expect(done('exit-mode')).toBe(true)
  })
})

describe('Lesson 4 — Emergencies & safety (playthrough)', () => {
  it('walks LEVEL, CWS, AEP, a sensor failure, and the altimeter gotcha', () => {
    const sim = makeSim()
    const L = lessonById('emergencies')
    const C = L.steps.map((s) => s.id)
    const at = (id) => L.steps[C.indexOf(id)]
    const done = (id) => at(id).check(sim.get())
    const run = (id) => at(id).setup?.(sim.actions)

    L.init(sim.actions)
    sim.tick(3.5)

    run('induce-bank')
    sim.tickUntil((s) => at('induce-bank').check(s), 30)
    expect(done('induce-bank')).toBe(true)

    sim.actions.apLvl()
    expect(done('level')).toBe(true)

    expect(done('level-recover')).toBe(true) // explanation step (emergencyLevel already true)

    // level-revert is a read-then-Next notice (no check): LEVEL auto-reverts to TRK
    run('level-revert')
    sim.tickUntil((s) => !s.emergencyLevel && s.lateralMode === 'TRK' && s.apEngaged, 40)
    expect(sim.get().emergencyLevel).toBe(false)
    expect(sim.get().lateralMode).toBe('TRK')

    // Min-airspeed protection (engaged): a held climb bleeds the speed -> MIN AS.
    // Also a read-then-Next notice (no check); the protection trips while watched.
    run('min-as')
    sim.tickUntil((s) => s.warning === 'MIN_AS', 30)
    expect(sim.get().warning).toBe('MIN_AS')
    expect(sim.get().curIAS).toBeLessThanOrEqual(62) // bled to the minimum

    run('cws') // ends the airspeed demo, then hand-fly with CWS
    sim.actions.cwsPress()
    const turned = (s) => Math.abs(((s.curTrack - s.cwsStartTrack + 540) % 360) - 180)
    sim.tickUntil((s) => turned(s) > 10, 30) // the hand-flown banked turn develops the heading
    sim.actions.cwsRelease()
    sim.tickUntil((s) => at('cws').check(s), 30) // AP rolls back to wings-level after release
    expect(done('cws')).toBe(true) // completes after the roll-out, with the new track
    expect(sim.get().lateralMode).toBe('TRK') // AP resumes holding it
    expect(Math.abs(sim.get().bankAngle)).toBeLessThan(3) // level before the next step pauses the clock

    sim.actions.knobHold() // disengage
    expect(done('disengage')).toBe(true)

    // AEP bank protection: the bank develops to ~45, AEP trips ACTIVE and nudges it
    // back to a safe ~35 (does not roll fully level), then catches it again — cycling
    run('aep-bank') // read-then-Next notice; setup induces the over-bank
    sim.tickUntil((s) => s.aep === 'active', 120)
    expect(Math.abs(sim.get().bankAngle)).toBeGreaterThan(40) // got past 40 toward ~45
    sim.tickUntil((s) => s.aep === 'stby', 30) // nudged back inside the limit
    expect(Math.abs(sim.get().bankAngle)).toBeLessThanOrEqual(37) // to ~35, not level
    sim.tickUntil((s) => s.aep === 'active', 60) // and it catches the bank again (cycles)
    expect(sim.get().aep).toBe('active')

    // AEP can be disabled with MODE while disengaged; the step levels the airplane
    run('aep-disable')
    expect(Math.abs(sim.get().bankAngle)).toBeLessThan(2) // wings-level as the step starts
    sim.actions.mode()
    expect(done('aep-disable')).toBe(true)

    run('sensor')
    sim.actions.setConfig({ warning: 'SENSOR' })
    expect(done('sensor')).toBe(true)

    sim.actions.setConfig({ power: 'off' })
    sim.actions.setConfig({ power: 'on' })
    expect(done('power-cycle')).toBe(true)

    sim.tick(3.5)
    expect(sim.get().power).toBe('on')

    altSync(sim)
    expect(done('gotcha')).toBe(true)
  })
})

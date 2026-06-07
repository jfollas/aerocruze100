import { useEffect, useReducer, useState, useMemo, useCallback } from 'react'
import { reducer, initialState } from './sim/machine.js'
import * as E from './sim/events.js'
import Device from './components/Device.jsx'
import ConfigPanel from './components/ConfigPanel.jsx'
import ConditionsPanel from './components/ConditionsPanel.jsx'
import MasterPanel from './components/MasterPanel.jsx'
import SkyviewKnobs from './components/SkyviewKnobs.jsx'
import Pfd from './components/Pfd.jsx'
import ApproachPanel from './components/ApproachPanel.jsx'
import TutorialPanel from './components/TutorialPanel.jsx'
import WelcomeModal from './components/WelcomeModal.jsx'
import { useTutorial } from './hooks/useTutorial.js'
import { LESSONS } from './sim/tutorials.js'
import './styles/app.css'

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState)
  const [variant, setVariant] = useState('flat')

  const actions = useMemo(
    () => ({
      mode: () => dispatch(E.mode()),
      alt: () => dispatch(E.alt()),
      rotate: (dir, fine) => dispatch(dir > 0 ? E.knobCw(fine) : E.knobCcw(fine)),
      knobPress: () => dispatch(E.knobPress()),
      knobHold: () => dispatch(E.knobHold()),
      cwsTap: () => dispatch(E.cwsTap()),
      cwsPress: () => dispatch(E.cwsPress()),
      cwsRelease: () => dispatch(E.cwsRelease()),
      apLvl: () => dispatch(E.apLvl()),
      setConfig: (patch) => dispatch(E.setConfig(patch)),
    }),
    []
  )

  // Walkthrough tutorial controller (step prompts, control highlight, clock pause).
  const tut = useTutorial(state, actions)
  const [picker, setPicker] = useState(false) // tutorials dropdown (top nav)
  const [conditions, setConditions] = useState(false) // induce-conditions popup (top nav)
  // First-load welcome / disclaimer modal (skipped if dismissed with "don't show again").
  const [welcome, setWelcome] = useState(() => {
    try {
      return localStorage.getItem('aerocruze.welcomeSeen') !== '1'
    } catch {
      return true
    }
  })

  // Open the Conditions popup automatically when a tutorial step highlights one
  // of the controls that now lives inside it, so the glow/control is visible.
  const COND_CTLS = ['lpvToggle', 'gpsSignal', 'windSlider', 'bankSlider', 'sensorBtn']
  useEffect(() => {
    if (tut.highlight && COND_CTLS.includes(tut.highlight)) setConditions(true)
  }, [tut.highlight])

  // Sim clock: ~10 Hz — the aircraft (and its PFD) is live regardless of the
  // autopilot's power state, but a tutorial freezes it during action steps.
  // During "fly the airplane" waits a tutorial step can accelerate time: we keep
  // the fixed 0.1 s integration step (so the flight model stays accurate) and
  // simply run `mult` ticks per 100 ms interval, advancing the sim mult× faster.
  const mult = tut.clockMultiplier || 1
  useEffect(() => {
    if (tut.paused) return
    const id = setInterval(() => {
      for (let i = 0; i < mult; i++) dispatch(E.tick(0.1))
    }, 100)
    return () => clearInterval(id)
  }, [tut.paused, mult])

  // Keyboard shortcuts (handy for desktop + testing).
  const onKey = useCallback(
    (e) => {
      if (e.target.tagName === 'INPUT') return
      if (welcome) return // the welcome modal handles keys for its practice knob
      const fine = e.shiftKey
      const map = {
        m: actions.mode,
        a: actions.alt,
        ArrowRight: () => actions.rotate(1, fine),
        ArrowUp: () => actions.rotate(1, fine),
        ArrowLeft: () => actions.rotate(-1, fine),
        ArrowDown: () => actions.rotate(-1, fine),
        Enter: actions.knobPress,
        ' ': actions.knobPress,
        Backspace: actions.knobHold,
      }
      const fn = map[e.key]
      if (fn) {
        e.preventDefault()
        fn()
      }
    },
    [actions, welcome]
  )
  useEffect(() => {
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onKey])

  return (
    <div className="app" data-tut-highlight={tut.highlight || undefined}>
      <div className="app-top">
        <h1 className="app-title">Aerocruze 100 Autopilot Simulator</h1>
        <div className="app-top-center">
          {!tut.active && (
            <div className="app-tut-launcher">
              <button className="tut-launch" onClick={() => setPicker((o) => !o)}>
                ▶ Tutorials
              </button>
              {picker && (
                <div className="tut-menu">
                  {LESSONS.map((l) => (
                    <button
                      key={l.id}
                      className="tut-lesson"
                      onClick={() => {
                        tut.start(l.id)
                        setPicker(false)
                      }}
                    >
                      <span className="tut-lesson-title">{l.title}</span>
                      <span className="tut-lesson-blurb">{l.blurb}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="app-top-right">
          <button className="cond-launch" onClick={() => setConditions((o) => !o)}>
            Conditions
          </button>
          {conditions && (
            <div className="cond-menu">
              <ConditionsPanel state={state} actions={actions} variant={variant} setVariant={setVariant} />
            </div>
          )}
        </div>
      </div>

      <main className="app-main">
        {/* Column 1: primary flight display + SkyView bug dials */}
        <div className="col col-pfd">
          <div className="cfg-group pfd-card">
            <h3>Primary Flight Display</h3>
            <Pfd state={state} actions={actions} />
          </div>
          <SkyviewKnobs state={state} actions={actions} />
        </div>

        {/* Column 2: the autopilot stack — unit, nav source, controls */}
        <div className="col col-ap">
          <div className="cfg-group device-card">
            <Device variant={variant} state={state} actions={actions} />
            <p className="app-foot">
              <kbd>M</kbd> mode · <kbd>A</kbd> alt · <kbd>←</kbd>/<kbd>→</kbd> twist (<kbd>Shift</kbd> fine) ·
              <kbd>Enter</kbd> press · <kbd>Backspace</kbd> hold. Familiarization only — not for flight use.
            </p>
          </div>
          <ConfigPanel state={state} actions={actions} />
          <MasterPanel state={state} actions={actions} />
        </div>

        {/* Column 3: approach plate */}
        <div className="col col-approach">
          <ApproachPanel state={state} actions={actions} />
        </div>
      </main>

      <TutorialPanel tut={tut} />

      {mult > 1 && (
        <div className="clock-accel" role="status" aria-live="polite">
          <span className="clock-accel-icon">⏩</span>
          <span className="clock-accel-x">{mult}×</span>
          <span className="clock-accel-lbl">fast-forward</span>
        </div>
      )}

      {welcome && <WelcomeModal onClose={() => setWelcome(false)} />}
    </div>
  )
}

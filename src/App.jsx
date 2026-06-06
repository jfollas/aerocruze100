import { useEffect, useReducer, useState, useMemo, useCallback } from 'react'
import { reducer, initialState } from './sim/machine.js'
import * as E from './sim/events.js'
import Device, { VARIANTS } from './components/Device.jsx'
import ConfigPanel from './components/ConfigPanel.jsx'
import MasterPanel from './components/MasterPanel.jsx'
// SkyviewKnobs is parked for now — it takes too much vertical space in the
// one-page layout. The component is kept intact; just re-add it below to restore.
// import SkyviewKnobs from './components/SkyviewKnobs.jsx'
import Pfd from './components/Pfd.jsx'
import ApproachPanel from './components/ApproachPanel.jsx'
import TutorialPanel from './components/TutorialPanel.jsx'
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

  // Sim clock: ~10 Hz — the aircraft (and its PFD) is live regardless of the
  // autopilot's power state, but a tutorial freezes it during action steps.
  useEffect(() => {
    if (tut.paused) return
    const id = setInterval(() => dispatch(E.tick(0.1)), 100)
    return () => clearInterval(id)
  }, [tut.paused])

  // Keyboard shortcuts (handy for desktop + testing).
  const onKey = useCallback(
    (e) => {
      if (e.target.tagName === 'INPUT') return
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
    [actions]
  )
  useEffect(() => {
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onKey])

  return (
    <div className="app" data-tut-highlight={tut.highlight || undefined}>
      <div className="app-top">
        <h1 className="app-title">Aerocruze 100 Autopilot Simulator</h1>
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

      <main className="app-main">
        {/* Left: autopilot simulator, unit selector, tabbed controls */}
        <div className="col col-left">
          <Device variant={variant} state={state} actions={actions} />
          <div className="switch-bar">
            <span className="switch-lbl">Unit</span>
            <div className="variant-switch">
              {Object.entries(VARIANTS).map(([key, v]) => (
                <button
                  key={key}
                  className={'var-btn' + (variant === key ? ' active' : '')}
                  onClick={() => setVariant(key)}
                >
                  {v.label}
                </button>
              ))}
            </div>
          </div>
          <ConfigPanel state={state} actions={actions} />
          <p className="app-foot">
            <kbd>M</kbd> mode · <kbd>A</kbd> alt · <kbd>←</kbd>/<kbd>→</kbd> twist (<kbd>Shift</kbd> fine) ·
            <kbd>Enter</kbd> press · <kbd>Backspace</kbd> hold. Familiarization only — not for flight use.
          </p>
        </div>

        {/* Center: primary flight display + aircraft master */}
        <div className="col col-center">
          <div className="cfg-group pfd-card">
            <h3>Primary Flight Display</h3>
            <Pfd state={state} actions={actions} />
          </div>
          {/* <SkyviewKnobs state={state} actions={actions} /> — hidden for now (vertical space) */}
          <MasterPanel state={state} actions={actions} />
        </div>

        {/* Right: approach plate */}
        <div className="col col-right">
          <ApproachPanel state={state} actions={actions} />
        </div>
      </main>

      <TutorialPanel tut={tut} />
    </div>
  )
}

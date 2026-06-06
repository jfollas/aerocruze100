import { useEffect, useReducer, useState, useMemo, useCallback } from 'react'
import { reducer, initialState } from './sim/machine.js'
import * as E from './sim/events.js'
import Device, { VARIANTS } from './components/Device.jsx'
import ConfigPanel from './components/ConfigPanel.jsx'
import MasterPanel from './components/MasterPanel.jsx'
import SkyviewKnobs from './components/SkyviewKnobs.jsx'
import Pfd from './components/Pfd.jsx'
import ApproachPanel from './components/ApproachPanel.jsx'
import './styles/app.css'

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState)
  const [variant, setVariant] = useState('flat')

  // Sim clock: ~10 Hz, always running — the aircraft (and its PFD) is live
  // regardless of the autopilot's power state.
  useEffect(() => {
    const id = setInterval(() => dispatch(E.tick(0.1)), 100)
    return () => clearInterval(id)
  }, [])

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
    <div className="app">
      <main className="app-main">
        {/* Left: title, autopilot simulator, tabbed controls */}
        <div className="col col-left">
          <header className="app-head">
            <h1>Aerocruze 100 Autopilot Simulator</h1>
            <p className="sub">Practice the buttonology of the BendixKing Aerocruze 100 (TruTrak Vizion PMA).</p>
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
          </header>
          <Device variant={variant} state={state} actions={actions} />
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
          <SkyviewKnobs state={state} actions={actions} />
          <MasterPanel state={state} actions={actions} />
        </div>

        {/* Right: approach plate */}
        <div className="col col-right">
          <ApproachPanel state={state} actions={actions} />
        </div>
      </main>
    </div>
  )
}

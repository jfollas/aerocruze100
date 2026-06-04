import { useEffect, useReducer, useState, useMemo, useCallback } from 'react'
import { reducer, initialState } from './sim/machine.js'
import * as E from './sim/events.js'
import Device, { VARIANTS } from './components/Device.jsx'
import ConfigPanel from './components/ConfigPanel.jsx'
import './styles/app.css'

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState)
  const [variant, setVariant] = useState('flat')

  // Sim clock: ~10 Hz while powered.
  useEffect(() => {
    if (state.power === 'off') return
    const id = setInterval(() => dispatch(E.tick(0.1)), 100)
    return () => clearInterval(id)
  }, [state.power])

  const actions = useMemo(
    () => ({
      mode: () => dispatch(E.mode()),
      alt: () => dispatch(E.alt()),
      rotate: (dir, fine) => dispatch(dir > 0 ? E.knobCw(fine) : E.knobCcw(fine)),
      knobPress: () => dispatch(E.knobPress()),
      knobHold: () => dispatch(E.knobHold()),
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
      <header className="app-head">
        <h1>Aerocruze 100 Autopilot Simulator</h1>
        <p className="sub">
          Practice the buttonology of the BendixKing Aerocruze 100 (TruTrak Vizion PMA). Tap MODE / ALT, drag the
          knob to twist, tap it to press, hold it to disengage.
        </p>
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
      </header>

      <main className="app-main">
        <Device variant={variant} state={state} dispatch={dispatch} actions={actions} />
        <ConfigPanel state={state} actions={actions} />
      </main>

      <footer className="app-foot">
        Keyboard: <kbd>M</kbd> mode · <kbd>A</kbd> alt · <kbd>←</kbd>/<kbd>→</kbd> twist (<kbd>Shift</kbd> = fine) ·
        <kbd>Enter</kbd> press · <kbd>Backspace</kbd> hold/disengage. For training only — not for navigation.
      </footer>
    </div>
  )
}

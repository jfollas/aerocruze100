import { useState, useEffect } from 'react'
import Knob from './Knob.jsx'
import '../styles/welcome.css'

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x))

// A live practice knob wired exactly like the real autopilot knob (same Knob
// component, same gestures), manipulating a demo value from -500 to 500.
// Normal twist steps by 10; a press-and-hold-then-twist makes fine 1-unit steps.
// Arrow keys (Shift = fine) and Enter mirror the real knob's keyboard shortcuts.
function PracticeKnob() {
  const [value, setValue] = useState(0)
  const [fine, setFine] = useState(false)
  const rotate = (dir, isFine) => {
    setFine(isFine)
    setValue((v) => clamp(v + dir * (isFine ? 1 : 10), -500, 500))
  }

  useEffect(() => {
    const onKey = (e) => {
      const f = e.shiftKey
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowUp':
          rotate(1, f)
          break
        case 'ArrowLeft':
        case 'ArrowDown':
          rotate(-1, f)
          break
        case 'Enter':
        case ' ':
          setValue(0)
          break
        default:
          return
      }
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="welc-practice">
      <div className="welc-knob-wrap">
        <Knob onRotate={rotate} onPress={() => setValue(0)} />
      </div>
      <div className="welc-readout">
        <div className="welc-value">{value}</div>
        <div className="welc-value-sub">
          {fine ? 'fine · ±1' : 'normal · ±10'} · range −500…500
        </div>
        <div className="welc-value-hint">tap the knob to reset to 0</div>
      </div>
    </div>
  )
}

export default function WelcomeModal({ onClose }) {
  const [dontShow, setDontShow] = useState(false)
  const close = () => {
    if (dontShow) {
      try {
        localStorage.setItem('aerocruze.welcomeSeen', '1')
      } catch {
        /* ignore storage failures */
      }
    }
    onClose()
  }

  return (
    <div className="welc-overlay" role="dialog" aria-modal="true" aria-labelledby="welc-title">
      <div className="welc-box">
        <div className="welc-head">
          <h2 id="welc-title">AeroCruze 100 Autopilot Simulator</h2>
          <button className="welc-x" onClick={close} aria-label="Close">
            ×
          </button>
        </div>

        <p className="welc-disclaimer">
          This is an <b>interpretation</b> of how the AeroCruze 100 / TruTrak Vizion autopilot
          should function, based on the published manuals. It is a familiarization and
          buttonology trainer — <b>not for flight use</b>. We can't render exact representations
          of the display fonts used on the actual device, so the on-screen text is an
          approximation.
        </p>

        <h3 className="welc-sub">Turning the knobs</h3>
        <ul className="welc-list">
          <li>
            <b>Drag right</b> to turn a knob <b>clockwise</b> (increase);{' '}
            <b>drag left</b> to turn it <b>counter-clockwise</b> (decrease).
          </li>
          <li>
            <b>Tap</b> (click without dragging) to <b>press</b> the knob in.
          </li>
          <li>
            <b>Press and hold</b> briefly <i>before</i> dragging to make <b>fine</b> adjustments
            (smaller increments) — like pushing the knob in before turning.
          </li>
          <li>
            <b>Hold</b> without dragging to <b>long-press</b> (disengage on the real knob).
          </li>
        </ul>
        <p className="welc-kbd-note">
          Keyboard equivalents: <kbd>←</kbd>/<kbd>→</kbd> twist, <kbd>Shift</kbd> for fine,{' '}
          <kbd>Enter</kbd> press.
        </p>

        <h3 className="welc-sub">Try it</h3>
        <p className="welc-try">
          Drag the knob below left and right. Hold before you drag for fine steps.
        </p>
        <PracticeKnob />

        <div className="welc-foot">
          <label className="welc-dontshow">
            <input
              type="checkbox"
              checked={dontShow}
              onChange={(e) => setDontShow(e.target.checked)}
            />
            Don't show this again
          </label>
          <button className="welc-start" onClick={close}>
            Get started
          </button>
        </div>
      </div>
    </div>
  )
}

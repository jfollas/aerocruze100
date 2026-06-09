import { useState, useRef, useEffect } from 'react'
import '../styles/welcome.css'

// Bump this when the modal's content changes — a user who chose "don't show
// again" at an older version will see it once more after an update.
export const WELCOME_VERSION = 1
const STORE_KEY = 'aerocruze.welcomeVersion'

// Show the modal unless the user has dismissed a version >= the current one.
export function shouldShowWelcome() {
  try {
    const seen = parseInt(localStorage.getItem(STORE_KEY), 10)
    return !(seen >= WELCOME_VERSION)
  } catch {
    return true
  }
}

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x))
const MIN = -500
const MAX = 500

// Interactive demo knob (per the design): drag left/right to twist (±10), hold
// before dragging for fine (±1), tap to reset, arrow keys / Shift / Enter too.
// The cyan pointer maps the −500…500 value to ±150°, echoing the device OLED.
function DemoKnob() {
  const [value, setValue] = useState(0)
  const [fine, setFine] = useState(false)
  const knobRef = useRef(null)
  const g = useRef({})
  const bump = (fn) => setValue((v) => clamp(fn(v), MIN, MAX))

  const down = (e) => {
    e.preventDefault()
    const s = g.current
    s.dragging = true
    s.moved = false
    s.fine = false
    s.startX = e.clientX
    s.accum = 0
    knobRef.current.setPointerCapture?.(e.pointerId)
    s.holdTimer = setTimeout(() => {
      if (s.dragging && !s.moved) {
        s.fine = true
        setFine(true)
      }
    }, 240)
  }
  const move = (e) => {
    const s = g.current
    if (!s.dragging) return
    const dx = e.clientX - s.startX
    if (Math.abs(dx) > 3) s.moved = true
    s.accum += dx
    s.startX = e.clientX
    const pxPer = s.fine ? 14 : 5 // px of drag per detent
    const stepSize = s.fine ? 1 : 10
    let delta = 0
    while (Math.abs(s.accum) >= pxPer) {
      delta += s.accum > 0 ? stepSize : -stepSize
      s.accum += s.accum > 0 ? -pxPer : pxPer
    }
    if (delta) bump((v) => v + delta)
  }
  const end = () => {
    const s = g.current
    if (!s.dragging) return
    s.dragging = false
    clearTimeout(s.holdTimer)
    if (!s.moved && !s.fine) bump(() => 0) // tap => reset
    s.fine = false
    setFine(false)
  }

  // Keyboard equivalents, focus-free, but yield to focused buttons/inputs.
  useEffect(() => {
    const onKey = (e) => {
      if (/^(INPUT|BUTTON|TEXTAREA|SELECT)$/.test(e.target.tagName)) return
      const s = e.shiftKey ? 1 : 10
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
        bump((v) => v + s)
        setFine(e.shiftKey)
        e.preventDefault()
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
        bump((v) => v - s)
        setFine(e.shiftKey)
        e.preventDefault()
      } else if (e.key === 'Enter' || e.key === ' ') {
        bump(() => 0)
        e.preventDefault()
      }
    }
    const onKeyUp = (e) => {
      if (!e.shiftKey) setFine(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [])

  const deg = (value / MAX) * 150
  return (
    <div className="welc-demo">
      <div
        ref={knobRef}
        className={'welc-knob' + (fine ? ' fine' : '')}
        tabIndex={0}
        role="slider"
        aria-valuemin={MIN}
        aria-valuemax={MAX}
        aria-valuenow={value}
        aria-label="Demo knob"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      >
        <div className="welc-pointer" style={{ transform: `translateX(-50%) rotate(${deg}deg)` }} />
        <div className="welc-hub" />
      </div>
      <div className="welc-readout">
        <div className="welc-val">{value}</div>
        <div className="welc-metaline">
          <span className={fine ? 'welc-live' : undefined}>{fine ? 'fine' : 'normal'}</span> ·{' '}
          {fine ? '±1' : '±10'} · range −500…500
        </div>
        <div className="welc-tap">tap the knob to reset to 0</div>
      </div>
    </div>
  )
}

export default function WelcomeModal({ onClose }) {
  const [dontShow, setDontShow] = useState(false)
  const close = () => {
    if (dontShow) {
      try {
        localStorage.setItem(STORE_KEY, String(WELCOME_VERSION))
      } catch {
        /* ignore storage failures */
      }
    }
    onClose()
  }

  return (
    <div className="welc-overlay">
      <div className="welc-modal" role="dialog" aria-modal="true" aria-labelledby="welc-ttl">
        <div className="welc-head">
          <span className="welc-mark">AC100</span>
          <div className="welc-ttl">
            <b id="welc-ttl">AeroCruze 100 Autopilot Simulator</b>
            <span>Familiarization &amp; buttonology trainer</span>
          </div>
          <button className="welc-close" aria-label="Close" onClick={close}>
            ✕
          </button>
        </div>

        <div className="welc-body">
          <p className="welc-lede">
            This is an <b>interpretation</b> of how the AeroCruze 100 / TruTrak Vizion autopilot
            should function, based on the published manuals. It is a familiarization and buttonology
            trainer — <span className="welc-danger">not for flight use</span>. On-screen text
            approximates the real device; exact display fonts aren't reproduced.
          </p>

          <p className="welc-legal">
            Looking For Traffic is <b>not affiliated with, endorsed by, or sponsored by</b> BendixKing
            or Honeywell. All product names, trademarks, and registered trademarks are the property of
            their respective owners.
          </p>

          <div className="welc-seclabel">Turning the knobs</div>
          <ul className="welc-steps">
            <li>
              <b>Drag right</b> to turn a knob <b>clockwise</b> (increase); <b>drag left</b> to turn it{' '}
              <b>counter-clockwise</b> (decrease).
            </li>
            <li>
              <b>Tap</b> (click without dragging) to <b>press</b> the knob in.
            </li>
            <li>
              <b>Press and hold</b> briefly <i>before</i> dragging to make <b>fine</b> adjustments —
              like pushing the knob in before turning.
            </li>
            <li>
              <b>Hold</b> without dragging to <b>long-press</b> (disengage on the real knob).
            </li>
          </ul>

          <p className="welc-keyline">
            Keyboard equivalents: <kbd>←</kbd> / <kbd>→</kbd> twist · <kbd>⇧ Shift</kbd> for fine ·{' '}
            <kbd>Enter</kbd> press
          </p>

          <div className="welc-tryit">
            <div className="welc-seclabel">Try it</div>
            <p className="welc-hint">Drag the knob left and right. Hold before you drag for fine steps.</p>
            <DemoKnob />
          </div>
        </div>

        <div className="welc-foot">
          <label className="welc-dontshow">
            <input
              type="checkbox"
              checked={dontShow}
              onChange={(e) => setDontShow(e.target.checked)}
            />
            <span className="welc-box"></span>
            <span>Don't show this again</span>
          </label>
          <button className="welc-cta" onClick={close}>
            Get started
          </button>
        </div>
      </div>
    </div>
  )
}

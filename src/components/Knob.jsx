import { useRef, useState } from 'react'

const STEP_PX = 14 // pixels of horizontal drag per detent
const STEP_DEG = 16 // degrees the mark turns per detent
const TAP_MS = 250 // up within this with no movement => press
const HOLD_MS = 1500 // held this long with no movement => long-press (disengage)
const FINE_MS = 350 // held this long before twisting => fine increments

// A circular knob you twist by dragging horizontally: drag right turns it
// clockwise (increment), drag left turns it counter-clockwise (decrement).
// Tap = press, hold = long-press, press-then-twist = fine increments (§5.3.1).
export default function Knob({ onRotate, onPress, onHold }) {
  const ref = useRef(null)
  const g = useRef(null)
  const [angle, setAngle] = useState(0)
  const [fine, setFine] = useState(false)

  const down = (e) => {
    e.preventDefault()
    ref.current.setPointerCapture(e.pointerId)
    g.current = {
      lastX: e.clientX,
      accum: 0,
      moved: false,
      fine: false,
      t0: performance.now(),
      holdTimer: setTimeout(() => {
        if (g.current && !g.current.moved) {
          g.current.consumed = true
          onHold?.()
        }
      }, HOLD_MS),
      consumed: false,
    }
  }

  const move = (e) => {
    const s = g.current
    if (!s) return
    const dx = e.clientX - s.lastX // + = dragging right, - = dragging left
    s.lastX = e.clientX
    s.accum += dx

    if (!s.moved && Math.abs(s.accum) > 4) {
      s.moved = true
      clearTimeout(s.holdTimer)
      const f = performance.now() - s.t0 > FINE_MS
      s.fine = f
      setFine(f)
    }
    if (!s.moved) return

    setAngle((x) => x + dx * (STEP_DEG / STEP_PX)) // turn the mark with the drag
    while (Math.abs(s.accum) >= STEP_PX) {
      const dir = s.accum > 0 ? 1 : -1 // right -> CW (+1), left -> CCW (-1)
      s.accum -= dir * STEP_PX
      onRotate?.(dir, s.fine)
    }
  }

  const up = () => {
    const s = g.current
    if (!s) return
    clearTimeout(s.holdTimer)
    if (!s.consumed && !s.moved && performance.now() - s.t0 < TAP_MS) onPress?.()
    g.current = null
    setFine(false)
  }

  return (
    <div
      ref={ref}
      className="knob-hit"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      role="button"
      tabIndex={0}
      aria-label="Autopilot knob — drag right/left to twist, tap to press, hold to disengage"
    >
      <div className="knob-mark" style={{ transform: `rotate(${angle}deg)` }} />
      {fine && <span className="knob-fine">FINE</span>}
    </div>
  )
}

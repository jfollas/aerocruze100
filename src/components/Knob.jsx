import { useRef, useState } from 'react'

const STEP_DEG = 16 // degrees of twist per detent
const TAP_MS = 250 // up within this with no movement => press
const HOLD_MS = 1500 // held this long with no movement => long-press (disengage)
const FINE_MS = 350 // held this long before twisting => fine increments

// A circular knob you twist by dragging around its center. Tap = press,
// hold = long-press, press-then-twist = fine increments (§5.3.1).
export default function Knob({ onRotate, onPress, onHold }) {
  const ref = useRef(null)
  const g = useRef(null)
  const [angle, setAngle] = useState(0)
  const [fine, setFine] = useState(false)

  const center = () => {
    const r = ref.current.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }
  const angleAt = (e, c) => (Math.atan2(e.clientY - c.y, e.clientX - c.x) * 180) / Math.PI

  const down = (e) => {
    e.preventDefault()
    ref.current.setPointerCapture(e.pointerId)
    const c = center()
    g.current = {
      c,
      last: angleAt(e, c),
      accum: 0,
      moved: false,
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
    const a = angleAt(e, s.c)
    let delta = a - s.last
    if (delta > 180) delta -= 360
    if (delta < -180) delta += 360
    s.last = a
    s.accum += delta

    if (!s.moved && Math.abs(s.accum) > 4) {
      s.moved = true
      clearTimeout(s.holdTimer)
      const f = performance.now() - s.t0 > FINE_MS
      s.fine = f
      setFine(f)
    }
    if (!s.moved) return

    setAngle((x) => x + delta)
    while (Math.abs(s.accum) >= STEP_DEG) {
      const dir = s.accum > 0 ? 1 : -1
      s.accum -= dir * STEP_DEG
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
      aria-label="Autopilot knob — drag to twist, tap to press, hold to disengage"
    >
      <div className="knob-mark" style={{ transform: `rotate(${angle}deg)` }} />
      {fine && <span className="knob-fine">FINE</span>}
    </div>
  )
}

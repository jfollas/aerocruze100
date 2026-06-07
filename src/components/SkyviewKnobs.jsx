import { useRef } from 'react'
import { mod360 } from '../sim/flight.js'
import '../styles/skyview.css'

// The Dynon SkyView knob panel as a tactile input for the bugs: twist (or
// scroll) the HDG/TRK knob to set the heading bug and the ALT knob to set the
// altitude bug; a click without a turn syncs the bug to the current value
// (like pushing the real encoder). BARO has no meaning in this sim, so it is
// shown but left inert.
const round = (x, step) => Math.round(x / step) * step
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x))

// knob centres as a percentage of the photo (594 × 304)
const KNOBS = [
  { id: 'hdg', cx: 15.5, cy: 54, dx: -2 },
  { id: 'alt', cx: 84, cy: 54 },
]
const SENS = { hdg: 0.5, alt: 8 } // value change per pixel of horizontal drag

export default function SkyviewKnobs({ state, actions }) {
  const set = actions.setConfig
  const { svHeadingBug, svAltBug, svAltBugSet, curTrack, curAlt } = state
  const drag = useRef(null)

  const apply = (id, val) => {
    if (id === 'hdg') set({ svHeadingBug: Math.round(mod360(val)) })
    else set({ svAltBug: clamp(round(val, 100), 0, 17500), svAltBugSet: true })
  }
  const sync = (id) => {
    if (id === 'hdg') set({ svHeadingBug: Math.round(mod360(curTrack)) })
    else set({ svAltBug: clamp(round(curAlt, 100), 0, 17500), svAltBugSet: true })
  }

  // Drag horizontally to turn: right = clockwise (increase), left = counter-
  // clockwise (decrease) — same gesture as the autopilot knob.
  const handlers = (id) => ({
    onPointerDown: (e) => {
      e.currentTarget.setPointerCapture?.(e.pointerId)
      drag.current = {
        id,
        lastX: e.clientX,
        start: id === 'hdg' ? svHeadingBug : svAltBug,
        total: 0,
      }
    },
    onPointerMove: (e) => {
      const d = drag.current
      if (!d || d.id !== id) return
      const dx = e.clientX - d.lastX // + = dragging right, - = dragging left
      d.lastX = e.clientX
      d.total += dx
      apply(id, d.start + d.total * SENS[id])
    },
    onPointerUp: () => {
      const d = drag.current
      if (d && d.id === id && Math.abs(d.total) < 6) sync(id) // negligible drag => a push
      drag.current = null
    },
    onPointerCancel: () => {
      drag.current = null
    },
  })

  const wheel = (id) => (e) => {
    const dir = -Math.sign(e.deltaY)
    if (id === 'hdg') set({ svHeadingBug: Math.round(mod360(svHeadingBug + dir)) })
    else set({ svAltBug: clamp(round(svAltBug + dir * 100, 100), 0, 17500), svAltBugSet: true })
  }

  return (
    <div className="cfg-group skv-card">
      <div className="skv-panel">
        <img
          className="skv-img"
          src={`${import.meta.env.BASE_URL}skyview-knobs.webp`}
          alt="Dynon SkyView HDG/TRK, BARO and ALT knobs"
          draggable={false}
        />
        {KNOBS.map((k) => (
          <button
            key={k.id}
            className={'skv-knob skv-' + k.id}
            data-ctl={k.id === 'hdg' ? 'svHdgKnob' : 'svAltKnob'}
            style={{ left: `calc(${k.cx}% + ${k.dx || 0}px)`, top: `calc(${k.cy}% + 6px)` }}
            title={k.id === 'hdg' ? 'HDG/TRK — drag left/right or scroll to set the heading bug, click to sync' : 'ALT — drag left/right or scroll to set the altitude bug, click to sync'}
            aria-label={k.id === 'hdg' ? 'Heading bug knob' : 'Altitude bug knob'}
            {...handlers(k.id)}
            onWheel={wheel(k.id)}
          />
        ))}
      </div>
    </div>
  )
}

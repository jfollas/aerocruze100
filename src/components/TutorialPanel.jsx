import { useState, useRef } from 'react'
import '../styles/tutorial.css'

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x))

// The active lesson's floating card, draggable by its header. It's non-modal:
// only the card is clickable so the live controls stay interactive. The lesson
// picker lives in the top nav; all step logic is in the useTutorial hook.
export default function TutorialPanel({ tut }) {
  const [pos, setPos] = useState({ x: 14, y: 56 }) // upper-left, below the top nav
  const drag = useRef(null)

  const head = {
    onPointerDown: (e) => {
      if (e.target.closest('button')) return
      e.currentTarget.setPointerCapture?.(e.pointerId)
      drag.current = { px: e.clientX, py: e.clientY, x: pos.x, y: pos.y }
    },
    onPointerMove: (e) => {
      if (!drag.current) return
      setPos({
        x: clamp(drag.current.x + (e.clientX - drag.current.px), 0, window.innerWidth - 80),
        y: clamp(drag.current.y + (e.clientY - drag.current.py), 0, window.innerHeight - 40),
      })
    },
    onPointerUp: () => {
      drag.current = null
    },
    onPointerCancel: () => {
      drag.current = null
    },
  }

  if (!tut.active) return null

  const { lesson, step, stepIndex, stepCount, flash } = tut
  const pct = Math.round(((stepIndex + (flash ? 1 : 0)) / stepCount) * 100)
  return (
    <div className="tut-wrap" style={{ left: pos.x, top: pos.y }}>
      <div className="tut-card">
        <div className="tut-head tut-drag" {...head}>
          <span className="tut-title">{lesson.title}</span>
          <span className="tut-count">
            {stepIndex + 1} / {stepCount}
          </span>
          <button className="tut-x" onClick={tut.exit} aria-label="Exit tutorial" title="Exit">
            ×
          </button>
        </div>
        <div className="tut-prog">
          <div className="tut-prog-fill" style={{ width: pct + '%' }} />
        </div>
        <p className="tut-prompt">{step.prompt}</p>
        {step.note && <p className="tut-note">{step.note}</p>}
        <div className="tut-status">
          {flash ? (
            <span className="tut-done">✓ done</span>
          ) : step.check ? (
            <span className="tut-wait">waiting for your action…</span>
          ) : (
            <span className="tut-wait">read, then Next →</span>
          )}
        </div>
        <div className="tut-actions">
          <button className="tut-btn" onClick={tut.prev} disabled={stepIndex === 0}>
            ‹ Prev
          </button>
          <button className="tut-btn tut-next" onClick={tut.next}>
            {step.check ? 'Skip ›' : 'Next ›'}
          </button>
        </div>
      </div>
    </div>
  )
}

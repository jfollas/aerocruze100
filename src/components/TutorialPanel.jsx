import { useState, useRef } from 'react'
import '../styles/tutorial.css'

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x))

// Avionic typesetting for the prompt: control/mode names (ALT, SEL VS, GS CPLD…)
// render as green "chips"; numeric flight values (3,500 ft, 700 fpm, 40°…) render
// as green monospace. Control tokens are matched case-sensitively so the button
// name "ALT" is chipped but the word "altitude" is not.
const CONTROLS = [
  'ALT HOLD', 'ALT SYNC', 'SEL VS', 'GS CPLD', 'GS ARM', 'GS FLG', 'GPS NAV',
  'MIN AS', 'MAX AS', 'CWS AP', 'MODE', 'LEVEL', 'GPSS', 'PWR', 'CWS', 'AEP',
  'SVS', 'TRK', 'ALT', 'SEL', 'VS',
].sort((a, b) => b.length - a.length)
const VALUE = '\\d[\\d,]*(?:\\.\\d+)?(?:\\s?(?:ft|fpm|kt|kts|knots|nm)\\b|°)'
const TOKEN_RE = new RegExp(`(${VALUE})|(\\b(?:${CONTROLS.join('|')})\\b)`, 'g')

function renderPrompt(text) {
  const out = []
  let last = 0
  for (const m of text.matchAll(TOKEN_RE)) {
    if (m.index > last) out.push(text.slice(last, m.index))
    if (m[1] != null) out.push(<span key={m.index} className="tut-val">{m[1]}</span>)
    else out.push(<span key={m.index} className="tut-chip">{m[2]}</span>)
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

// The active lesson's floating card, draggable by its header. It's non-modal:
// only the card is clickable so the live controls stay interactive. The lesson
// picker lives in the top nav; all step logic is in the useTutorial hook.
export default function TutorialPanel({ tut }) {
  const [pos, setPos] = useState({ x: 14, y: 56 }) // upper-left, below the top nav
  const drag = useRef(null)

  const head = {
    draggable: false,
    // Block the browser's native drag (it otherwise grabs a ghost image of the
    // page/selection when you start dragging the header).
    onDragStart: (e) => e.preventDefault(),
    onPointerDown: (e) => {
      if (e.target.closest('button')) return
      e.preventDefault() // suppress native text-selection / element drag
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
  const isLast = stepIndex === stepCount - 1
  const pct = Math.round(((stepIndex + (flash ? 1 : 0)) / stepCount) * 100)
  const statusKind = flash || isLast ? 'done' : step.check ? 'wait' : 'read'
  const statusLabel = flash
    ? 'step complete'
    : isLast
      ? 'tutorial complete'
      : step.check
        ? 'waiting for your action…'
        : 'read, then continue →'
  return (
    <div className="tut-wrap" style={{ left: pos.x, top: pos.y }}>
      <div className="tut-card">
        <div className="tut-head tut-drag" {...head}>
          <span className="tut-icon" aria-hidden="true">✈</span>
          <span className="tut-title">{lesson.title}</span>
          <span className="tut-count">
            {stepIndex + 1} / {stepCount}
          </span>
          <button className="tut-x" onClick={tut.exit} aria-label="Exit tutorial" title="Exit">
            ✕
          </button>
        </div>
        <div className="tut-prog">
          <div className="tut-prog-fill" style={{ width: pct + '%' }} />
        </div>
        <p className="tut-prompt">{renderPrompt(step.prompt)}</p>
        {step.note && <p className="tut-note">{step.note}</p>}
        <div className={'tut-status tut-status-' + statusKind}>
          {statusKind === 'done' ? (
            <span className="tut-status-tick">✓</span>
          ) : (
            <span className="tut-status-dot" />
          )}
          <span className="tut-status-txt">{statusLabel}</span>
        </div>
        <div className="tut-actions">
          <button className="tut-btn" onClick={tut.prev} disabled={stepIndex === 0}>
            ‹ Prev
          </button>
          <button className="tut-btn tut-next" onClick={tut.next}>
            {isLast ? 'Finish ›' : step.check ? 'Skip ›' : 'Next ›'}
          </button>
        </div>
      </div>
    </div>
  )
}

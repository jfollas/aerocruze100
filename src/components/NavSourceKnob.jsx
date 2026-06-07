import '../styles/navknob.css'

// A rotary mode-selector knob for the autopilot nav source. Each position sits
// at an explicit clock angle (degrees from top, clockwise); the pointer rotates
// to the active one. Click a label to select, or click the knob to step on.
const SPAN = 300 // fallback span if a position doesn't specify its own angle
const CX = 160
const CY = 96
const rad = (d) => (d * Math.PI) / 180
const px = (a, r) => CX + r * Math.sin(rad(a))
const py = (a, r) => CY - r * Math.cos(rad(a))

export default function NavSourceKnob({ value, options, onChange, ctl }) {
  const n = options.length
  const step = SPAN / Math.max(1, n - 1)
  const angleAt = (o, i) => (o.angle != null ? o.angle : -SPAN / 2 + i * step)
  const idx = Math.max(0, options.findIndex((o) => o.value === value))
  const sel = angleAt(options[idx], idx)
  const next = () => onChange(options[(idx + 1) % n].value)

  return (
    <div className="navknob" data-ctl={ctl}>
      <svg viewBox="0 0 320 158" className="navknob-svg" role="group" aria-label="Nav source selector">
        <defs>
          <radialGradient id="navknob-face-grad" cx="38%" cy="32%" r="75%">
            <stop offset="0%" stopColor="#39424f" />
            <stop offset="60%" stopColor="#222a35" />
            <stop offset="100%" stopColor="#161c25" />
          </radialGradient>
        </defs>

        {/* detent ticks around the dial */}
        {options.map((o, i) => {
          const a = angleAt(o, i)
          return <line key={'t' + o.value} className="navknob-tick" x1={px(a, 54)} y1={py(a, 54)} x2={px(a, 62)} y2={py(a, 62)} />
        })}

        {/* knob body */}
        <circle className="navknob-base" cx={CX} cy={CY} r={48} />
        <circle className="navknob-face" cx={CX} cy={CY} r={42} onClick={next} />

        {/* rotating pointer */}
        <g className="navknob-rotor" style={{ transform: `rotate(${sel}deg)`, transformOrigin: `${CX}px ${CY}px` }}>
          <line className="navknob-ptr" x1={CX} y1={CY} x2={CX} y2={CY - 38} />
          <circle className="navknob-ptr-dot" cx={CX} cy={CY - 34} r={4.5} />
        </g>
        <circle className="navknob-cap" cx={CX} cy={CY} r={9} onClick={next} />

        {/* position labels */}
        {options.map((o, i) => {
          const a = angleAt(o, i)
          const anchor = Math.abs(a) < 12 ? 'middle' : a > 0 ? 'start' : 'end'
          return (
            <text
              key={o.value}
              x={px(a, 80)}
              y={py(a, 80) + 4}
              textAnchor={anchor}
              className={'navknob-label' + (value === o.value ? ' active' : '')}
              onClick={() => onChange(o.value)}
            >
              {o.text}
            </text>
          )
        })}
      </svg>
    </div>
  )
}

import { deriveDisplay } from '../sim/screens.js'
import '../styles/lcd.css'

// Small reusable pieces -------------------------------------------------------

function Qual({ char }) {
  if (!char) return null
  return <span className="lcd-qual lcd-flash">{char}</span>
}

// per-symbol class so the GPS signal indicator can be placed individually
const qualSym = (char) => (char.includes('+') ? 'q-plus' : char === '*' ? 'q-star' : 'q-dot')

function Big({ children, underline }) {
  return <span className={'lcd-big' + (underline ? ' lcd-underline' : '')}>{children}</span>
}

function Stacked({ words }) {
  return (
    <span className="lcd-stacked">
      <span className="lcd-sup">{words[0]}</span>
      <span className="lcd-big">{words[1]}</span>
    </span>
  )
}

// Zone renderers --------------------------------------------------------------

function VertSet() {
  return (
    <span className="lcd-vertset">
      {'SET'.split('').map((c, i) => (
        <span key={i}>{c}</span>
      ))}
    </span>
  )
}

function TopLeft({ tl, suppressQual }) {
  if (!tl) return null
  return (
    <div className="lcd-zone tl">
      <span className="lcd-headcol">
        <span className="lcd-lbl">{tl.header}</span>
        {!suppressQual && <Qual char={tl.qual} />}
      </span>
      {tl.value != null && <Big>{tl.value}</Big>}
      {tl.trim && tl.trim !== 'none' && (
        <span className="lcd-trim">{tl.trim === 'up' ? 'U▲' : 'DN▼'}</span>
      )}
    </div>
  )
}

function BottomLeft({ bl, cursor }) {
  if (!bl) return null
  if (bl.apOff) {
    return (
      <div className="lcd-zone bl annun">
        <span className="lcd-sup">AEP</span>
        <Big>{`${bl.aep} AP OFF`}</Big>
      </div>
    )
  }
  if (bl.text) {
    return (
      <div className={'lcd-zone bl' + (bl.flashing ? ' lcd-flash' : '')}>
        <Big>{bl.text}</Big>
      </div>
    )
  }
  if (bl.header && bl.value == null) {
    // a label-only line (e.g. "SEL VS" in the alt-select setup)
    return (
      <div className="lcd-zone bl">
        <span className="lcd-lbl">{bl.header}</span>
      </div>
    )
  }
  return (
    <div className="lcd-zone bl">
      <span className="lcd-lbl">{bl.label}</span>
      <Big underline={cursor === 'track'}>{bl.value}</Big>
    </div>
  )
}

// An altitude rendered with its hundreds in a smaller size (e.g. 16500 -> "16"
// large + "500" small), matching the device's altitude pre-select display.
function AltValue({ value, underline }) {
  const v = Math.round(value)
  if (v < 1000) return <Big underline={underline}>{String(v)}</Big>
  const thousands = Math.floor(v / 1000)
  const hundreds = String(v % 1000).padStart(3, '0')
  // thousands render larger than normal; hundreds at normal size, top-aligned
  return (
    <span className={'lcd-alt' + (underline ? ' lcd-underline' : '')}>
      <span className="lcd-alt-k">{thousands}</span>
      <span className="lcd-big">{hundreds}</span>
    </span>
  )
}

function TopRight({ tr }) {
  if (!tr) return null
  if (tr.plain) {
    return (
      <div className="lcd-zone tr">
        <span className="lcd-lbl">{tr.value}</span>
      </div>
    )
  }
  return (
    <div className="lcd-zone tr">
      {tr.label && <span className="lcd-lbl">{tr.label}</span>}
      {tr.alt != null ? (
        <AltValue value={tr.alt} underline={tr.underline} />
      ) : (
        <Big underline={tr.underline}>{tr.value}</Big>
      )}
    </div>
  )
}

function BottomRight({ br, cursor }) {
  if (!br) return null
  if (br.stacked) {
    return (
      <div className="lcd-zone br">
        <Stacked words={br.stacked} />
      </div>
    )
  }
  return (
    <div className="lcd-zone br">
      <span className="lcd-lbl">{br.label}</span>
      <Big underline={br.underline || cursor === 'vs'}>
        {br.value}
        {br.arrow}
      </Big>
    </div>
  )
}

// Main ------------------------------------------------------------------------

export default function LcdDisplay({ state }) {
  const d = deriveDisplay(state)

  if (d.off) return <div className="lcd lcd-off" />

  // Full-screen templates (boot, sensor error, AEP active)
  if (d.full) {
    return (
      <div className={'lcd' + (d.klass ? ' ' + d.klass : '') + (d.flashing ? ' lcd-flash' : '')}>
        {d.header && <div className="lcd-zone tl"><span className="lcd-lbl">{d.header}</span></div>}
        <div className="lcd-full">
          {d.full.map((line, i) => (
            <div key={i} className="lcd-full-line">{line}</div>
          ))}
        </div>
      </div>
    )
  }

  // Setting screens (contrast / min backlight / setup)
  if (d.setting) {
    return (
      <div className="lcd">
        <div className="lcd-setting">
          <span className="lcd-set-lbl">{d.setting.label}</span>
          <span className="lcd-big lcd-underline">{d.setting.value}</span>
        </div>
      </div>
    )
  }

  // gyro-trim big value
  if (d.bigValue) {
    return (
      <div className="lcd">
        <TopLeft tl={d.topLeft} />
        <div className="lcd-trim-val lcd-big">{d.bigValue}</div>
        <BottomRight br={d.bottomRight} />
      </div>
    )
  }

  // On the home screen the GPS signal indicator is placed at a fixed position
  // (per symbol), independent of the header, rather than flowing under it.
  const homeQual = d.klass === 'lcd-home' ? d.topLeft?.qual : null

  return (
    <div className={'lcd' + (d.klass ? ' ' + d.klass : '')}>
      <TopLeft tl={d.topLeft} suppressQual={!!homeQual} />
      {homeQual && (
        <span className={'lcd-qual lcd-flash lcd-qual-fixed ' + qualSym(homeQual)}>{homeQual}</span>
      )}
      {d.vertSet && <VertSet />}
      <BottomLeft bl={d.bottomLeft} cursor={d.cursor} />
      <TopRight tr={d.topRight} />
      <BottomRight br={d.bottomRight} cursor={d.cursor} />
    </div>
  )
}

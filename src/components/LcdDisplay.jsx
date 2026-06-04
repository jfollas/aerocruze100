import { deriveDisplay } from '../sim/screens.js'
import '../styles/lcd.css'

// Small reusable pieces -------------------------------------------------------

function Qual({ char }) {
  if (!char) return null
  return <span className="lcd-qual lcd-flash">{char}</span>
}

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

function TopLeft({ tl, vertSet }) {
  if (!tl) return null
  return (
    <div className="lcd-zone tl">
      <span className="lcd-headcol">
        <span className="lcd-lbl">{tl.header}</span>
        <Qual char={tl.qual} />
      </span>
      {vertSet && <VertSet />}
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
      <Big underline={tr.underline}>{tr.value}</Big>
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
      <div className={'lcd' + (d.flashing ? ' lcd-flash' : '')}>
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

  return (
    <div className="lcd">
      <TopLeft tl={d.topLeft} vertSet={d.vertSet} />
      <BottomLeft bl={d.bottomLeft} cursor={d.cursor} />
      <TopRight tr={d.topRight} />
      <BottomRight br={d.bottomRight} cursor={d.cursor} />
    </div>
  )
}

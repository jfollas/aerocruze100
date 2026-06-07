import NavSourceKnob from './NavSourceKnob.jsx'
import '../styles/config.css'

// The autopilot accepts one nav source at a time. In our aircraft a panel
// selector switch discretely picks between the Dynon SkyView and the Garmin
// GNS430W; the other navigators are kept here for completeness. Each option
// maps to a mutually-exclusive set of the underlying signal flags.
const NAV_SOURCES = {
  none: { gpsData: 'none', arinc: 'none', skyview: 'off' },
  gns430w: { gpsData: 'ifr', arinc: 'none', skyview: 'off' }, // WAAS IFR -> GPSS + LPV
  skyview: { gpsData: 'none', arinc: 'none', skyview: 'on' },
  portable: { gpsData: 'portable', arinc: 'none', skyview: 'off' }, // RS-232 -> GPS NAV
  aspen: { gpsData: 'ifr', arinc: 'aspen', skyview: 'off' },
  g5: { gpsData: 'ifr', arinc: 'g5', skyview: 'off' },
}

// Derive which selector position the current signal flags represent.
function navSourceOf(s) {
  if (s.skyview === 'on') return 'skyview'
  if (s.arinc === 'aspen') return 'aspen'
  if (s.arinc === 'g5') return 'g5'
  if (s.gpsData === 'ifr') return 'gns430w'
  if (s.gpsData === 'portable') return 'portable'
  return 'none'
}

// A segmented control bound to one config field. Shared with the Induce
// Conditions popup (ConditionsPanel).
export function Seg({ label, value, options, onChange, ctl }) {
  return (
    <div className="cfg-row" data-ctl={ctl}>
      <span className="cfg-label">{label}</span>
      <div className="cfg-seg">
        {options.map((o) => (
          <button
            key={o.value}
            className={'cfg-opt' + (value === o.value ? ' active' : '')}
            onClick={() => onChange(o.value)}
          >
            {o.text}
          </button>
        ))}
      </div>
    </div>
  )
}

// NAV SOURCE card: what's feeding the autopilot. The outlier "induce conditions"
// signals now live in the top-nav Conditions popup (ConditionsPanel).
export default function ConfigPanel({ state, actions }) {
  const set = actions.setConfig

  return (
    <div className="cfg-group">
      <h3>Nav source</h3>
      <NavSourceKnob
        ctl="navSource"
        value={navSourceOf(state)}
        options={[
          { value: 'skyview', text: 'SkyView', angle: -60 }, // 10 o'clock
          { value: 'gns430w', text: 'GPS', angle: 0 }, // 12 o'clock
          { value: 'none', text: 'None', angle: 60 }, // 2 o'clock
        ]}
        onChange={(p) => set(NAV_SOURCES[p])}
      />
    </div>
  )
}

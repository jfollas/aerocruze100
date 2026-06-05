import ApproachMap from './ApproachMap.jsx'
import { AP_MIN_MSL } from '../sim/geo.js'
import '../styles/approach.css'

const IAFS = [
  { id: 'LEYIR', text: 'LEYIR (N)' },
  { id: 'WUDAT', text: 'WUDAT (S)' },
]

// Practice flying the RNAV (GPS) RWY 10 into Wood County Regional (1G0) on the
// to-scale chart. How the aircraft is flown depends on how the autopilot is set
// up: GNS430W + GPSS flies the plan and couples the LPV glidepath at ZIMBO;
// SkyView lets you hand-fly with the bugs (no glidepath).
export default function ApproachPanel({ state, actions }) {
  const set = actions.setConfig
  const active = state.scenarioActive
  const warn = active && state.apEngaged && state.curAlt <= AP_MIN_MSL

  const vmLabel = { GS_ARM: 'GS ARM', GS_CPLD: 'GS CPLD', ALTHOLD: 'ALT', SEL: 'ALT SEL', SVS: 'VS' }[state.verticalMode] || '—'

  return (
    <section className="apch">
      <div className="apch-head">
        <div className="apch-title">
          <h3>RNAV (GPS) RWY 10 · Wood County (1G0)</h3>
          <p>
            Set the nav source &amp; modes for the job: <b>GNS430W</b> + engage + MODE→<b>GPSS</b> flies the plan and
            couples the LPV glidepath at ZIMBO (you manage altitude to the FAF). <b>SkyView</b> lets you hand-fly with
            the HDG/ALT/VS bugs — no glidepath.
          </p>
        </div>
        <div className="apch-ctrls">
          <span className="apch-ctrl-lbl">Start at IAF</span>
          <div className="apch-iafs">
            {IAFS.map((f) => (
              <button
                key={f.id}
                className={'apch-iaf' + (state.scenarioIaf === f.id ? ' active' : '')}
                onClick={() => set({ scenarioActive: true, scenarioIaf: f.id })}
              >
                {f.text}
              </button>
            ))}
            <button className="apch-reset" disabled={!active} onClick={() => set({ scenarioActive: false, scenarioIaf: null })}>
              Reset
            </button>
          </div>
        </div>
      </div>

      {warn && (
        <div className="apch-warn" role="alert">
          ⚠ AUTOPILOT NOT AUTHORIZED BELOW 700 AGL ({AP_MIN_MSL}′) — DISCONNECT AND HAND-FLY
        </div>
      )}

      <div className="apch-views">
        <ApproachMap state={state} />
        <div className="apch-side">
          <div className="apch-status">
            <span><b>IAF</b> {state.scenarioIaf || '—'}</span>
            <span><b>Alt</b> {active ? Math.round(state.curAlt) + '′' : '—'}</span>
            <span><b>AGL</b> {active && state.agl != null ? Math.round(state.agl) + '′' : '—'}</span>
            <span><b>Vert</b> {active ? vmLabel : '—'}</span>
          </div>
          <div className="apch-legend">
            <span><svg viewBox="0 0 18 18" className="apch-legend-ico"><path d="M9 2 L11 8 L16 11 L11 11 L9 16 L7 11 L2 11 L7 8 Z" /></svg> aircraft on the plan view &amp; profile</span>
            <span><span className="apch-legend-line" /> 700 AGL — autopilot floor</span>
          </div>
        </div>
      </div>
    </section>
  )
}

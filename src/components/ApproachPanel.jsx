import { useState } from 'react'
import ApproachMap from './ApproachMap.jsx'
import { AP_MIN_MSL } from '../sim/geo.js'
import '../styles/approach.css'

const IAFS = [
  { id: 'LEYIR', text: 'LEYIR (N)' },
  { id: 'WUDAT', text: 'WUDAT (S)' },
  { id: 'UBAYA_DIRECT', text: 'UBAYA·straight-in (W)' },
  { id: 'UBAYA_TEARDROP', text: 'UBAYA·teardrop (SE)' },
  { id: 'UBAYA_PARALLEL', text: 'UBAYA·parallel (NE)' },
]

const iafLabel = (id) =>
  ({
    UBAYA_DIRECT: 'UBAYA',
    UBAYA_TEARDROP: 'UBAYA',
    UBAYA_PARALLEL: 'UBAYA',
  })[id] || id || '—'

// Practice flying the RNAV (GPS) RWY 10 into Wood County Regional (1G0) on the
// to-scale chart. How the aircraft is flown depends on how the autopilot is set
// up: GNS430W + GPSS flies the plan and couples the LPV glidepath at ZIMBO;
// SkyView lets you hand-fly with the bugs (no glidepath).
export default function ApproachPanel({ state, actions }) {
  const set = actions.setConfig
  const active = state.scenarioActive
  const warn = active && state.apEngaged && state.curAlt <= AP_MIN_MSL
  const [showInfo, setShowInfo] = useState(false)

  const vmLabel = { GS_ARM: 'GS ARM', GS_CPLD: 'GS CPLD', ALTHOLD: 'ALT', SEL: 'ALT SEL', SVS: 'VS' }[state.verticalMode] || '—'

  return (
    <section className="apch">
      <div className="apch-head">
        <div className="apch-titlebar">
          <h3>RNAV (GPS) RWY 10 · Wood County (1G0)</h3>
          <button className="apch-info" onClick={() => setShowInfo(true)} title="How to fly this approach" aria-label="Instructions">
            i
          </button>
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

      {showInfo && (
        <div className="apch-modal" role="dialog" aria-modal="true" onClick={() => setShowInfo(false)}>
          <div className="apch-modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="apch-modal-head">
              <h4>Flying the RNAV (GPS) RWY 10</h4>
              <button className="apch-modal-x" onClick={() => setShowInfo(false)} aria-label="Close">×</button>
            </div>
            <p>
              Set the nav source &amp; modes for the job. With <b>GNS430W</b>: engage, then MODE → <b>GPSS</b> — the GPS
              flies the published plan and couples the LPV glidepath at ZIMBO. You manage the altitude down to the FAF
              (e.g. ALT HOLD 2300), then the autopilot tracks the 3.04° path to the runway. The autopilot is not
              authorized below 700 ft AGL — disconnect and hand-fly when the warning shows.
            </p>
            <p>
              With <b>SkyView</b> as the source you hand-fly using the HDG / ALT / VS bugs (no glidepath coupling) — handy
              to get a feel for the bugs.
            </p>
            <p>
              Pick a start fix: <b>LEYIR</b> / <b>WUDAT</b> are the straight-in T-bar arms. At <b>UBAYA</b>, arriving
              from the <b>west</b> you're already on the final course, so it's a straight-in (<b>NoPT</b>); arriving
              from the <b>east</b> the 430W flies the hold-in-lieu procedure turn — a <b>teardrop</b> from the SE or a
              <b>parallel</b> entry from the NE.
            </p>
          </div>
        </div>
      )}

      {warn && (
        <div className="apch-warn" role="alert">
          ⚠ AUTOPILOT NOT AUTHORIZED BELOW 700 AGL ({AP_MIN_MSL}′) — DISCONNECT AND HAND-FLY
        </div>
      )}

      <div className="apch-views">
        <ApproachMap state={state} />
        <div className="apch-side">
          <div className="apch-status">
            <span><b>IAF</b> {active ? iafLabel(state.scenarioIaf) : '—'}</span>
            {state.hilptEntry &&
              (state.hilptEntry === 'NoPT' ? (
                <span><b>NoPT</b> straight-in</span>
              ) : (
                <span><b>HILPT</b> {state.hilptEntry}</span>
              ))}
            <span><b>Alt</b> {active ? Math.round(state.curAlt) + '′' : '—'}</span>
            <span><b>AGL</b> {active && state.agl != null ? Math.round(state.agl) + '′' : '—'}</span>
            <span><b>Vert</b> {active ? vmLabel : '—'}</span>
            {state.windSpd > 0 && (
              <span>
                <b>Wind</b> {String(Math.round(state.windNow?.fromMag ?? state.windDir)).padStart(3, '0')}°/{Math.round(state.windNow?.speed ?? 0)}
              </span>
            )}
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

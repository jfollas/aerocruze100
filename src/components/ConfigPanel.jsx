import { useState } from 'react'
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

// A segmented control bound to one config field.
function Seg({ label, value, options, onChange }) {
  return (
    <div className="cfg-row">
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

// Tabbed systems card: NAV SOURCE (what's feeding the autopilot) and INDUCE
// CONDITIONS (outlier signals to trigger for familiarization).
export default function ConfigPanel({ state, actions }) {
  const set = actions.setConfig
  const on = state.power === 'on'
  const [tab, setTab] = useState('nav')

  return (
    <div className="cfg-group cfg-tabs-card">
      <div className="cfg-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'nav'} className={'cfg-tab' + (tab === 'nav' ? ' active' : '')} onClick={() => setTab('nav')}>
          Nav source
        </button>
        <button role="tab" aria-selected={tab === 'induce'} className={'cfg-tab' + (tab === 'induce' ? ' active' : '')} onClick={() => setTab('induce')}>
          Induce conditions
        </button>
      </div>

      {tab === 'nav' && (
        <div className="cfg-tab-body">
          <Seg
            label="Source"
            value={navSourceOf(state)}
            options={[
              { value: 'gns430w', text: '430W' },
              { value: 'skyview', text: 'SkyView' },
              { value: 'portable', text: 'Portable' },
              { value: 'aspen', text: 'Aspen' },
              { value: 'g5', text: 'G5' },
              { value: 'none', text: 'None' },
            ]}
            onChange={(p) => set(NAV_SOURCES[p])}
          />
          {state.gpsData === 'ifr' && (
            <Seg
              label="LPV approach"
              value={state.approachActive ? 'yes' : 'no'}
              options={[
                { value: 'no', text: 'Off' },
                { value: 'yes', text: 'Active' },
              ]}
              onChange={(p) => set({ approachActive: p === 'yes' })}
            />
          )}
        </div>
      )}

      {tab === 'induce' && (
        <div className="cfg-tab-body">
          <Seg
            label="GPS signal"
            value={state.gpsStatus}
            options={[
              { value: 'NOGPS', text: 'None' },
              { value: 'NOFIX', text: 'No fix' },
              { value: 'OK', text: 'OK' },
            ]}
            onChange={(p) => set({ gpsStatus: p })}
          />
          <Seg
            label="Airspeed"
            value={state.groundSpeed > 10 ? 'fly' : 'gnd'}
            options={[
              { value: 'gnd', text: '< 10 kt' },
              { value: 'fly', text: '> 10 kt' },
            ]}
            onChange={(p) => set({ groundSpeed: p === 'fly' ? 120 : 0 })}
          />
          <div className="cfg-row">
            <span className="cfg-label">Wind dir (aloft)</span>
            <input
              type="range"
              min="0"
              max="350"
              step="10"
              value={state.windDir}
              onChange={(e) => set({ windDir: Number(e.target.value) })}
            />
            <span className="cfg-val">{String(state.windDir).padStart(3, '0')}°</span>
          </div>
          <div className="cfg-row">
            <span className="cfg-label">Wind speed (aloft)</span>
            <input
              type="range"
              min="0"
              max="45"
              value={state.windSpd}
              onChange={(e) => set({ windSpd: Number(e.target.value) })}
            />
            <span className="cfg-val">{state.windSpd} kt</span>
          </div>
          <Seg
            label="Trim"
            value={state.trim}
            options={[
              { value: 'none', text: 'OK' },
              { value: 'up', text: 'Up' },
              { value: 'dn', text: 'Down' },
            ]}
            onChange={(p) => set({ trim: p })}
          />
          <Seg
            label="Airspeed"
            value={state.warning === 'MIN_AS' ? 'min' : state.warning === 'MAX_AS' ? 'max' : 'ok'}
            options={[
              { value: 'ok', text: 'Normal' },
              { value: 'min', text: 'Min AS' },
              { value: 'max', text: 'Max AS' },
            ]}
            onChange={(p) => set({ warning: p === 'min' ? 'MIN_AS' : p === 'max' ? 'MAX_AS' : null })}
          />
          <div className="cfg-row">
            <span className="cfg-label">Bank (AEP)</span>
            <input
              type="range"
              min="0"
              max="60"
              value={Math.abs(state.inducedBank)}
              disabled={state.apEngaged}
              onChange={(e) => set({ inducedBank: Number(e.target.value) })}
            />
            <span className="cfg-val">{Math.abs(Math.round(state.bankAngle))}°</span>
          </div>
          <div className="cfg-row">
            <span className="cfg-label">Sensor</span>
            <div className="cfg-seg">
              <button className="cfg-opt" disabled={!on || state.warning === 'SENSOR'} onClick={() => set({ warning: 'SENSOR' })}>
                Trigger error
              </button>
              <button className="cfg-opt" disabled={!on} onClick={() => set({ power: 'off' })}>
                Power cycle
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

import { Seg } from './ConfigPanel.jsx'
import { VARIANTS } from './Device.jsx'
import '../styles/config.css'

// INDUCE CONDITIONS: the display unit choice plus outlier signals to trigger for
// familiarization (GPS loss, wind, trim, airspeed flags, bank/AEP, sensor
// error). Rendered in the top-nav Conditions popup so it stays out of the way.
export default function ConditionsPanel({ state, actions, variant, setVariant }) {
  const set = actions.setConfig
  const on = state.power === 'on'

  return (
    <>
      <div className="cfg-row">
        <span className="cfg-label">Unit</span>
        <div className="cfg-seg">
          {Object.entries(VARIANTS).map(([key, v]) => (
            <button key={key} className={'cfg-opt' + (variant === key ? ' active' : '')} onClick={() => setVariant(key)}>
              {v.label}
            </button>
          ))}
        </div>
      </div>
      <Seg
        label="GPS signal"
        ctl="gpsSignal"
        value={state.gpsStatus}
        options={[
          { value: 'NOGPS', text: 'None' },
          { value: 'NOFIX', text: 'No fix' },
          { value: 'OK', text: 'OK' },
        ]}
        onChange={(p) => set({ gpsStatus: p })}
      />
      {state.gpsData === 'ifr' && (
        <Seg
          label="LPV approach"
          ctl="lpvToggle"
          value={state.approachActive ? 'yes' : 'no'}
          options={[
            { value: 'no', text: 'Off' },
            { value: 'yes', text: 'Active' },
          ]}
          onChange={(p) => set({ approachActive: p === 'yes' })}
        />
      )}
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
        <input type="range" min="0" max="350" step="10" value={state.windDir} onChange={(e) => set({ windDir: Number(e.target.value) })} />
        <span className="cfg-val">{String(state.windDir).padStart(3, '0')}°</span>
      </div>
      <div className="cfg-row" data-ctl="windSlider">
        <span className="cfg-label">Wind speed (aloft)</span>
        <input type="range" min="0" max="45" value={state.windSpd} onChange={(e) => set({ windSpd: Number(e.target.value) })} />
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
      <div className="cfg-row" data-ctl="bankSlider">
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
          <button className="cfg-opt" data-ctl="sensorBtn" disabled={!on || state.warning === 'SENSOR'} onClick={() => set({ warning: 'SENSOR' })}>
            Trigger error
          </button>
          <button className="cfg-opt" disabled={!on} onClick={() => set({ power: 'off' })}>
            Power cycle
          </button>
        </div>
      </div>
    </>
  )
}

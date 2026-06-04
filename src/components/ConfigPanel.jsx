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

export default function ConfigPanel({ state, actions }) {
  const set = actions.setConfig
  const on = state.power === 'on'
  return (
    <div className="config">
      <div className="cfg-group">
        <h3>Aircraft master</h3>
        <Seg
          label="Power"
          value={state.power === 'off' ? 'off' : 'on'}
          options={[
            { value: 'off', text: 'OFF' },
            { value: 'on', text: 'ON' },
          ]}
          onChange={(p) => set({ power: p })}
        />
        <div className="cfg-row">
          <span className="cfg-label">Yoke switches</span>
          <div className="cfg-seg">
            <button
              className="cfg-opt"
              disabled={!on}
              onPointerDown={actions.cwsPress}
              onPointerUp={actions.cwsRelease}
              onPointerLeave={actions.cwsRelease}
              title="Control Wheel Steering — hold to maneuver"
            >
              CWS (hold)
            </button>
            <button className="cfg-opt" disabled={!on} onClick={actions.apLvl} title="Emergency Level">
              AP&nbsp;LVL
            </button>
          </div>
        </div>
      </div>

      <div className="cfg-group">
        <h3>Nav source (panel selector)</h3>
        <Seg
          label="Source"
          value={navSourceOf(state)}
          options={[
            { value: 'gns430w', text: 'GNS430W' },
            { value: 'skyview', text: 'SkyView' },
            { value: 'portable', text: 'Portable' },
            { value: 'aspen', text: 'Aspen' },
            { value: 'g5', text: 'G5' },
            { value: 'none', text: 'None' },
          ]}
          onChange={(p) => set(NAV_SOURCES[p])}
        />
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
          label="Ground speed"
          value={state.groundSpeed > 10 ? 'fly' : 'gnd'}
          options={[
            { value: 'gnd', text: '< 10 kt' },
            { value: 'fly', text: '> 10 kt' },
          ]}
          onChange={(p) => set({ groundSpeed: p === 'fly' ? 120 : 0 })}
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

      {state.skyview === 'on' && (
        <div className="cfg-group">
          <h3>Dynon SkyView bugs</h3>
          <Seg
            label="CDI source"
            value={state.skyviewCdi}
            options={[
              { value: 'heading', text: 'Heading bug' },
              { value: 'flightplan', text: 'Flight plan' },
              { value: 'navaid', text: 'VOR/LOC/ILS' },
            ]}
            onChange={(p) => set({ skyviewCdi: p })}
          />
          <div className="cfg-row">
            <span className="cfg-label">Heading bug</span>
            <input
              type="range"
              min="0"
              max="359"
              value={state.svHeadingBug}
              onChange={(e) => set({ svHeadingBug: Number(e.target.value) })}
            />
            <span className="cfg-val">{state.svHeadingBug}°</span>
          </div>
          <Seg
            label="Altitude bug"
            value={state.svAltBugSet ? 'on' : 'off'}
            options={[
              { value: 'off', text: 'Not set' },
              { value: 'on', text: 'Set' },
            ]}
            onChange={(p) => set({ svAltBugSet: p === 'on' })}
          />
          <div className="cfg-row">
            <span className="cfg-label">Alt bug</span>
            <input
              type="range"
              min="0"
              max="17500"
              step="100"
              value={state.svAltBug}
              disabled={!state.svAltBugSet}
              onChange={(e) => set({ svAltBug: Number(e.target.value) })}
            />
            <span className="cfg-val">{state.svAltBug}</span>
          </div>
          <div className="cfg-row">
            <span className="cfg-label">VS bug</span>
            <input
              type="range"
              min="-1500"
              max="1500"
              step="100"
              value={state.svVsBug}
              onChange={(e) => set({ svVsBug: Number(e.target.value) })}
            />
            <span className="cfg-val">{state.svVsBug}</span>
          </div>
        </div>
      )}

      <div className="cfg-group">
        <h3>Induce conditions</h3>
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
            <button
              className="cfg-opt"
              disabled={!on || state.warning === 'SENSOR'}
              onClick={() => set({ warning: 'SENSOR' })}
            >
              Trigger error
            </button>
            <button className="cfg-opt" disabled={!on} onClick={() => set({ power: 'off' })}>
              Power cycle
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

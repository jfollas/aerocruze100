import { useRef } from 'react'

const CWS_HOLD_MS = 350 // held longer than this => CWS mode; shorter => a tap (disengage)

// The aircraft master controls: CWS button, power toggle, and emergency LEVEL.
export default function MasterPanel({ state, actions }) {
  const set = actions.setConfig
  const on = state.power === 'on' // fully powered (CWS / LEVEL available)
  const powerUp = state.power !== 'off' // switch position (up while booting too)

  // CWS: a quick tap disengages the AP; holding enters CWS mode (release resumes).
  const cws = useRef({ down: false, holding: false, timer: null })
  const cwsDown = (e) => {
    e.currentTarget.setPointerCapture?.(e.pointerId)
    cws.current.down = true
    cws.current.holding = false
    cws.current.timer = setTimeout(() => {
      cws.current.holding = true
      actions.cwsPress()
    }, CWS_HOLD_MS)
  }
  const cwsUp = () => {
    if (!cws.current.down) return
    cws.current.down = false
    clearTimeout(cws.current.timer)
    if (cws.current.holding) {
      actions.cwsRelease()
      cws.current.holding = false
    } else {
      actions.cwsTap()
    }
  }

  return (
    <div className="cfg-group">
      <h3>Autopilot controls</h3>
      <div className="master-panel">
        <div className="master-ctl">
          <button
            className="cws-btn"
            disabled={!on}
            onPointerDown={cwsDown}
            onPointerUp={cwsUp}
            onPointerCancel={cwsUp}
            aria-label="Control Wheel Steering — tap to disengage, hold to maneuver"
            title="CWS — tap to disengage the autopilot; hold to maneuver, release to resume"
          />
          <span className="master-cap">CWS</span>
        </div>

        <div className="master-ctl">
          <button
            className={'power-toggle' + (powerUp ? ' on' : '')}
            role="switch"
            aria-checked={powerUp}
            aria-label="Power master switch"
            title="Power — flip up for ON, down for OFF"
            onClick={() => set({ power: powerUp ? 'off' : 'on' })}
          >
            <span className="toggle-track">
              <span className="toggle-lever" />
            </span>
          </button>
          <span className="master-cap">PWR · {powerUp ? 'ON' : 'OFF'}</span>
        </div>

        <div className="master-ctl">
          <button
            className="level-btn"
            disabled={!on}
            onClick={actions.apLvl}
            aria-label="Emergency Level"
            title="Emergency Level"
          >
            LEVEL
          </button>
          <span className="master-cap">LEVEL</span>
        </div>
      </div>
    </div>
  )
}

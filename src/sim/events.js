// Event type constants for the autopilot state machine.
// Every user interaction and the sim clock funnel through reducer(state, event).

export const MODE = 'MODE' // momentary press of MODE button
export const ALT = 'ALT' // momentary press of ALT button
export const KNOB_CW = 'KNOB_CW' // knob twisted clockwise one detent ({ fine })
export const KNOB_CCW = 'KNOB_CCW' // knob twisted counter-clockwise one detent ({ fine })
export const KNOB_PRESS = 'KNOB_PRESS' // momentary press & release of knob
export const KNOB_HOLD = 'KNOB_HOLD' // press & hold knob ~1.5s (disengage)
export const CWS_PRESS = 'CWS_PRESS' // control-wheel-steering switch pressed/held
export const CWS_RELEASE = 'CWS_RELEASE' // CWS released
export const AP_LVL = 'AP_LVL' // emergency level button
export const TICK = 'TICK' // sim clock tick ({ dt } in seconds)
export const SET_CONFIG = 'SET_CONFIG' // merge config/power fields ({ ...patch })

// Convenience creators
export const mode = () => ({ type: MODE })
export const alt = () => ({ type: ALT })
export const knobCw = (fine = false) => ({ type: KNOB_CW, fine })
export const knobCcw = (fine = false) => ({ type: KNOB_CCW, fine })
export const knobPress = () => ({ type: KNOB_PRESS })
export const knobHold = () => ({ type: KNOB_HOLD })
export const cwsPress = () => ({ type: CWS_PRESS })
export const cwsRelease = () => ({ type: CWS_RELEASE })
export const apLvl = () => ({ type: AP_LVL })
export const tick = (dt) => ({ type: TICK, dt })
export const setConfig = (patch) => ({ type: SET_CONFIG, ...patch })

// deriveDisplay(state) -> a structured model the LcdDisplay component renders.
// Faithful to the handbook figures: a two-row, four-zone operating screen plus
// several full-screen / setup templates.

import { isGyro } from './machine.js'

const pad = (n) => String(Math.round(n)).padStart(3, '0')
const hasFlightPlan = (s) => s.gpsData === 'portable' || s.gpsData === 'ifr'

// Top-left flashing GPS-quality character (§4.1.1).
function gpsQual(s) {
  if (s.skyview === 'on') return '+' // SkyView feeds the AP a valid data signal
  if (s.gpsStatus === 'NOGPS') return null
  let char
  if (s.arinc === 'aspen' && hasFlightPlan(s)) char = 'A+'
  else if (s.arinc === 'g5' && hasFlightPlan(s)) char = 'E+'
  else if (hasFlightPlan(s)) char = '+'
  else if (s.gpsStatus === 'OK') char = '*'
  else if (s.gpsStatus === 'NOFIX') char = '.'
  else return null
  return char
}

const arrow = (vs) => (vs > 0 ? '↑' : vs < 0 ? '↓' : '')

// Bottom-right vertical annunciation for the engaged operating screen.
function verticalZone(s) {
  if (s.warning === 'MIN_AS' || s.warning === 'MAX_AS') {
    // SYS stays on the bottom-right; the warning sits top-right (handled below).
  }
  switch (s.verticalMode) {
    case 'ALTHOLD':
      return { stacked: ['ALT', 'HOLD'] }
    case 'GS_ARM':
      return { stacked: ['GS', 'ARM'] }
    case 'GS_CPLD':
      return { stacked: ['GS', 'CPLD'] }
    case 'GS_FLG':
      return { stacked: ['GS', 'FLG'] }
    case 'SEL':
    case 'SVS':
    default:
      return { label: 'SYS', value: String(Math.round(Math.abs(s.selVS))), arrow: arrow(s.selVS) }
  }
}

// Lateral annunciation shown bottom-left when engaged.
function lateralZone(s) {
  if (isGyro(s)) return null // bank info lives top-left in gyro mode
  switch (s.lateralMode) {
    case 'GPSNAV':
      return { text: 'GPS NAV' }
    case 'GPSS':
      return { text: 'GPSS' }
    case 'ASPEN':
      return { text: 'ASPEN HDG' }
    case 'EXT':
      return { text: 'EXT HDG' }
    case 'TRK':
    default:
      return { label: 'SEL', value: pad(s.selTrack) }
  }
}

export function deriveDisplay(s) {
  if (s.power === 'off') return { off: true }

  if (s.power === 'booting') {
    return { header: 'NO GPS', full: ['VIZION 380 VZ.5'] }
  }

  if (s.warning === 'SENSOR') {
    return { full: ['SENSOR', 'ERROR'], flashing: true, center: false }
  }

  if (!s.apEngaged && s.aep === 'active') {
    return { full: ['AEP', 'ACTIVE'] }
  }

  // Setup screens (§4.4)
  if (s.screen === 'CONTRAST') return { setting: { label: 'CONTRAST', value: s.contrast } }
  if (s.screen === 'MIN_BKLT') return { setting: { label: 'MIN BKLT', value: s.minBklt } }
  if (s.screen === 'SETUP') return { setting: { label: 'SETUP', value: '' } }

  // Altimeter sync (§5.1) — matches the two reference photos.
  if (s.screen === 'ALT_SYNC') {
    return {
      topLeft: { header: 'ALT SYNC' },
      vertSet: true,
      topRight: { value: String(Math.round(s.baro)), underline: true },
    }
  }

  // Gyro trim (§8.3)
  if (s.screen === 'GYRO_TRIM') {
    return {
      topLeft: { header: 'TRIM', qual: gpsQual(s) },
      bigValue: `${s.gyroTrim.toFixed(1)}°/MIN`,
      bottomRight: { label: 'SYS', value: '0' },
    }
  }

  // Altitude select / pre-select setup (§5.4.3, §5.4.4). Larger SEL ALT label,
  // thousands larger than the (normal-size, top-aligned) hundreds, no vertical SET.
  if (s.screen === 'SEL_ALT') {
    const model = {
      klass: 'lcd-sel-alt',
      topLeft: { header: 'SEL ALT' },
      topRight: { alt: Math.round(s.selAlt), underline: s.cursor === 'altSel' },
    }
    if (s.apEngaged) {
      model.bottomLeft = { header: 'SEL VS' }
      model.bottomRight = { value: String(Math.round(Math.abs(s.selVS))), arrow: arrow(s.selVS), underline: s.cursor === 'vs' }
    }
    return model
  }

  // SkyView mode (Installation Manual §10.2). Header is SKYVIEW; lateral follows
  // the heading bug (SEL) or a flight plan (GPS); the altitude bug shows top-right.
  if (s.lateralMode === 'SKYVIEW') {
    const model = { cursor: s.cursor }
    model.topLeft = { header: 'SKYVIEW', qual: gpsQual(s) }
    model.bottomLeft =
      s.skyviewCdi === 'flightplan' ? { text: 'GPS' } : { label: 'SEL', value: pad(s.selTrack) }
    if (s.svAltBugSet) model.topRight = { label: 'ALT', value: String(Math.round(s.svAltBug)) }
    model.bottomRight = verticalZone(s)
    return model
  }

  // ---- Normal operating screen ----
  const model = { cursor: s.cursor }

  // Top-left zone
  if (!s.apEngaged) {
    if (s.gpsStatus === 'OK' && s.groundSpeed > 10) {
      model.topLeft = { header: 'TRK', qual: gpsQual(s), value: pad(s.curTrack), trim: s.trim }
    } else if (s.gpsStatus === 'OK') {
      model.topLeft = { header: 'GPS OK', qual: gpsQual(s) }
    } else if (s.gpsStatus === 'NOFIX') {
      model.topLeft = { header: 'NO FIX', qual: gpsQual(s) }
    } else {
      model.topLeft = { header: 'NO GPS' }
    }
    // Disengaged bottom row: AEP arming + AP OFF (§4.1.1, §8.2)
    model.bottomLeft = { aep: s.aep === 'stby' ? 'STBY' : 'OFF', apOff: true }
    return model
  }

  // Engaged
  if (s.emergencyLevel) {
    model.topLeft = { header: 'BANK', qual: gpsQual(s), value: '0°' }
    model.bottomRight = { label: 'SYS', value: '0' }
    return model
  }
  if (isGyro(s)) {
    const b = Math.round(Math.abs(s.selBank))
    const side = s.selBank > 0 ? 'R' : s.selBank < 0 ? 'L' : ''
    model.topLeft = { header: 'BANK', qual: gpsQual(s), value: `${b}°${side}` }
    model.bottomRight = verticalZone(s)
    return model
  }

  model.topLeft = { header: 'TRK', qual: gpsQual(s), value: pad(s.curTrack), trim: s.trim }
  model.bottomLeft = lateralZone(s)

  if (s.cwsHeld) {
    // Control-wheel-steering overlay (§5.4.7)
    model.bottomLeft = { text: 'CWS AP', flashing: true }
  }

  // Right side
  if (s.warning === 'MIN_AS') model.topRight = { value: 'MIN AS', plain: true }
  else if (s.warning === 'MAX_AS') model.topRight = { value: 'MAX AS', plain: true }
  else if (['SEL', 'ALTHOLD', 'GS_ARM', 'GS_CPLD', 'GS_FLG'].includes(s.verticalMode)) {
    model.topRight = { label: 'SEL', value: String(Math.round(s.selAlt)) }
  }
  model.bottomRight = verticalZone(s)
  return model
}

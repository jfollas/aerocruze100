// deriveDisplay(state) -> a structured model the LcdDisplay component renders.
// Faithful to the handbook figures: a two-row, four-zone operating screen plus
// several full-screen / setup templates.

import { isGyro } from './machine.js'

const pad = (n) => String(Math.round(n)).padStart(3, '0')
const hasFlightPlan = (s) => s.gpsData === 'portable' || s.gpsData === 'ifr'

// Top-left flashing GPS-quality character (§4.1.1). A bare "+" is rendered with
// a leading space (" +") so the "+" glyph lands in the same column whether
// or not there's an "A"/"E" source prefix (A+ / E+).
const PLUS = ' +' // leading non-breaking space keeps "+" aligned with A+/E+
function gpsQual(s) {
  if (s.skyview === 'on') return PLUS // SkyView feeds the AP a valid data signal
  if (s.gpsStatus === 'NOGPS') return null
  let char
  if (s.arinc === 'aspen' && hasFlightPlan(s)) char = 'A+'
  else if (s.arinc === 'g5' && hasFlightPlan(s)) char = 'E+'
  else if (hasFlightPlan(s)) char = PLUS
  else if (s.gpsStatus === 'OK') char = '*'
  else if (s.gpsStatus === 'NOFIX') char = '.'
  else return null
  return char
}

const arrow = (vs) => (vs > 0 ? '↑' : vs < 0 ? '↓' : '')

// Bottom-right vertical annunciation for the engaged operating screen.
function verticalZone(s) {
  // On a MIN_AS/MAX_AS warning the SVS stays here on the bottom-right; the
  // warning itself sits top-right (handled in deriveDisplay).
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
      return { label: 'SVS', value: String(Math.round(Math.abs(s.selVS))), arrow: arrow(s.selVS) }
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
    return { klass: 'lcd-home', header: 'NO GPS', full: ['AEROCRUZE 100'] }
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
      klass: 'lcd-alt-sync',
      topLeft: { header: 'ALT SYNC' },
      vertSet: true,
      topRight: { value: String(Math.round(s.curAlt + s.altDelta)), underline: true },
    }
  }

  // Gyro trim (§8.3)
  if (s.screen === 'GYRO_TRIM') {
    return {
      topLeft: { header: 'TRIM', qual: gpsQual(s) },
      bigValue: `${s.gyroTrim.toFixed(1)}°/MIN`,
      bottomRight: { label: 'SVS', value: '0' },
    }
  }

  // Altitude select / pre-select setup (§5.4.3, §5.4.4). Larger SEL ALT label,
  // thousands larger than the (normal-size, top-aligned) hundreds, with the
  // vertical SET prompt in the centre (as on the ALT SYNC page).
  if (s.screen === 'SEL_ALT') {
    const model = {
      klass: 'lcd-sel-alt',
      topLeft: { header: 'SEL ALT' },
      vertSet: true,
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
    // Shares the operating-screen layout (lcd-op); lcd-sky tweaks the SVS label
    // to align with the ALT/SEL right-column left.
    const model = { klass: 'lcd-op lcd-sky', cursor: s.cursor }
    model.topLeft = { header: 'SKYVIEW', qual: gpsQual(s) }
    model.bottomLeft =
      s.skyviewCdi === 'flightplan' ? { text: 'GPS' } : { label: 'SEL', value: pad(s.selTrack) }
    if (s.svAltBugSet) model.topRight = { label: 'ALT', alt: Math.round(s.svAltBug) }
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
      model.klass = 'lcd-home'
    } else if (s.gpsStatus === 'NOFIX') {
      model.topLeft = { header: 'NO FIX', qual: gpsQual(s) }
      model.klass = 'lcd-home'
    } else {
      model.topLeft = { header: 'NO GPS' }
      model.klass = 'lcd-home'
    }
    // Disengaged bottom row: AEP arming + AP OFF (§4.1.1, §8.2)
    model.bottomLeft = { aep: s.aep === 'stby' ? 'STBY' : 'OFF', apOff: true }
    return model
  }

  // Engaged. The BANK + SVS layout is shared by emergency level (§8.1) and the
  // gyro-backup screen when engaged without a valid GPS (§4.1.2, §8.3).
  if (s.emergencyLevel) {
    const b = Math.round(Math.abs(s.bankAngle))
    const side = s.bankAngle > 1 ? 'R' : s.bankAngle < -1 ? 'L' : ''
    return { elvl: { qual: gpsQual(s), bank: `${b}°`, side, vert: verticalZone(s), cursor: s.cursor } }
  }
  if (isGyro(s)) {
    const b = Math.round(Math.abs(s.selBank))
    const side = s.selBank > 0 ? 'R' : s.selBank < 0 ? 'L' : ''
    return { elvl: { qual: gpsQual(s), bank: `${b}°`, side, vert: verticalZone(s), cursor: s.cursor } }
  }

  model.klass = 'lcd-op' // engaged operating screen (TRK/GPSS/GPS NAV …), §5.3
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
    // SEL altitude renders with the smaller/raised hundreds (like the pre-select),
    // underlined when the editing cursor is on it (SEL mode: track -> vs -> altSel).
    model.topRight = { label: 'SEL', alt: Math.round(s.selAlt), underline: s.cursor === 'altSel' }
  }
  model.bottomRight = verticalZone(s)
  return model
}

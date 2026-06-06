// Geographic helpers for the to-scale RNAV (GPS) RWY 10 approach into Wood
// County Regional (1G0), Bowling Green OH. We project lat/lon onto a local
// nautical-mile frame centred on the airport reference point: x = east, y =
// north. At this scale (a few nm) an equirectangular projection is plenty.

import { mod360 } from './flight.js'

export const ARP = { lat: 41.391, lon: -83.6301 } // airport reference point
export const FIELD_ELEV = 675 // ft MSL
export const TDZE = 673 // ft MSL — touchdown zone / missed-approach point
const MAG_VAR = -6 // deg; west variation. true = mag + MAG_VAR
export const FINAL_CRS_MAG = 96 // RWY 10 final approach course (magnetic)
const AP_MIN_AGL = 700 // ft; autopilot not authorised below this AGL
export const AP_MIN_MSL = TDZE + AP_MIN_AGL // 1373 ft — autopilot floor advisory

// Published fixes (decimal degrees).
export const FIXES = {
  LEYIR: { lat: 41.51035, lon: -83.88077 }, // IAF, north T-arm (NoPT)
  WUDAT: { lat: 41.31082, lon: -83.88383 }, // IAF, south T-arm (NoPT)
  UBAYA: { lat: 41.39419, lon: -83.88255 }, // IAF / IF (HILPT — phase 2)
  ZIMBO: { lat: 41.39291, lon: -83.74408 }, // FAF — glidepath couples here
  RW10: { lat: 41.3919, lon: -83.63523 }, // landing threshold / MAP (4.9 NM past ZIMBO)
}

const NM_PER_DEG = 60 // 1° of latitude ≈ 60 nm
const toRad = (d) => (d * Math.PI) / 180

// lat/lon -> { x (east nm), y (north nm) } relative to `origin`.
export function project(lat, lon, origin = ARP) {
  const y = (lat - origin.lat) * NM_PER_DEG
  const x = (lon - origin.lon) * NM_PER_DEG * Math.cos(toRad(origin.lat))
  return { x, y }
}

// Precomputed projected positions for every fix.
export const FIX_XY = Object.fromEntries(
  Object.entries(FIXES).map(([k, f]) => [k, project(f.lat, f.lon)])
)

// Distance between two { x, y } points, in nm.
export function nmBetween(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

// True bearing (deg, 0..360) of the vector from `from` to `to`. North is +y,
// east is +x, so the compass bearing is atan2(east, north).
export function bearingToTrue(from, to) {
  return mod360((Math.atan2(to.x - from.x, to.y - from.y) * 180) / Math.PI)
}

export const magToTrue = (deg) => mod360(deg + MAG_VAR)
export const trueToMag = (deg) => mod360(deg - MAG_VAR)

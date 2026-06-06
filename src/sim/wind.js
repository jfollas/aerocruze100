// Boundary-layer wind model (Northern Hemisphere, over land).
//
// The user sets the *gradient* (free-stream) wind that prevails at and above the
// top of the friction layer (~2000 ft AGL). Descending into the friction layer
// the wind backs (rotates counter-clockwise) and slows toward the surface — the
// Ekman spiral. We use the standard aviation rule of thumb: the surface wind is
// ~50% the speed and ~30° backed relative to the 2000 ft wind, interpolating
// linearly with height. This makes the wind shift in a predictable way through
// the descent so the autopilot's GPS-course wind correction (crab) is tested.

import { mod360 } from './flight.js'
import { magToTrue } from './geo.js'

const toRad = (d) => (d * Math.PI) / 180
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x))

export const WIND_GRAD_AGL = 2000 // ft AGL: top of the friction layer (gradient wind above)
export const WIND_SURFACE_FRAC = 0.5 // surface speed as a fraction of the gradient wind
export const WIND_SURFACE_BACK = 30 // deg the surface wind is backed (CCW) from the gradient

// Wind (from-direction °magnetic, speed kt) at a height AGL.
export function windAt(aglFt, gradFromMag, gradSpeedKt) {
  if (!gradSpeedKt) return { fromMag: mod360(gradFromMag), speed: 0 }
  const f = clamp(aglFt / WIND_GRAD_AGL, 0, 1) // 0 at the surface, 1 at/above the gradient level
  const speed = gradSpeedKt * (WIND_SURFACE_FRAC + (1 - WIND_SURFACE_FRAC) * f)
  const fromMag = mod360(gradFromMag - WIND_SURFACE_BACK * (1 - f)) // backed near the surface, veers up
  return { fromMag, speed }
}

// Wind as a TRUE-frame velocity vector {wx (east), wy (north)} in kt — the
// direction the air is actually moving toward (the from-direction + 180°).
export function windVector(aglFt, gradFromMag, gradSpeedKt) {
  const { fromMag, speed } = windAt(aglFt, gradFromMag, gradSpeedKt)
  if (!speed) return { wx: 0, wy: 0 }
  const to = toRad(magToTrue(fromMag) + 180)
  return { wx: speed * Math.sin(to), wy: speed * Math.cos(to) }
}

// The heading (true) that makes good a desired ground track (true) given a wind
// vector and true airspeed — i.e. the wind-correction/crab angle baked in. Solve
// the wind triangle: the airspeed's component across the track cancels the wind's.
export function windCorrectedHeadingTrue(trackTrue, wind, tas) {
  if (tas <= 0) return mod360(trackTrue)
  const t = toRad(trackTrue)
  const rx = Math.cos(t) // right-perpendicular of the track unit (sin t, cos t)
  const ry = -Math.sin(t)
  const wPerp = wind.wx * rx + wind.wy * ry // crosswind component (+ from the left, pushing right)
  const wca = -Math.asin(clamp(wPerp / tas, -1, 1)) // crab into the wind
  return mod360(trackTrue + (wca * 180) / Math.PI)
}

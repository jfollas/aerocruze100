import { describe, it, expect } from 'vitest'
import { windAt, windVector, windCorrectedHeadingTrue, WIND_GRAD_AGL, WIND_SURFACE_FRAC, WIND_SURFACE_BACK } from './wind.js'

describe('boundary-layer wind profile', () => {
  it('is the full gradient wind at/above the friction-layer top', () => {
    const w = windAt(WIND_GRAD_AGL, 270, 40)
    expect(w.speed).toBeCloseTo(40, 5)
    expect(w.fromMag).toBeCloseTo(270, 5)
    // and unchanged higher up
    expect(windAt(WIND_GRAD_AGL + 3000, 270, 40).speed).toBeCloseTo(40, 5)
  })

  it('backs and slows toward the surface (Ekman spiral, NH)', () => {
    const surf = windAt(0, 270, 40)
    expect(surf.speed).toBeCloseTo(40 * WIND_SURFACE_FRAC, 5) // ~50%
    expect(surf.fromMag).toBeCloseTo(270 - WIND_SURFACE_BACK, 5) // backed ~30° CCW
  })

  it('interpolates monotonically between surface and gradient', () => {
    const mid = windAt(WIND_GRAD_AGL / 2, 270, 40)
    expect(mid.speed).toBeGreaterThan(windAt(0, 270, 40).speed)
    expect(mid.speed).toBeLessThan(40)
    expect(mid.fromMag).toBeGreaterThan(270 - WIND_SURFACE_BACK)
    expect(mid.fromMag).toBeLessThan(270)
  })

  it('zero gradient wind yields no wind vector', () => {
    expect(windVector(1000, 180, 0)).toEqual({ wx: 0, wy: 0 })
  })
})

describe('wind correction (crab)', () => {
  it('no wind -> heading equals the desired track', () => {
    expect(windCorrectedHeadingTrue(90, { wx: 0, wy: 0 }, 100)).toBeCloseTo(90, 5)
  })

  it('crabs into a crosswind from the right', () => {
    // track north (000T); wind blowing toward the east (from the west) pushes the
    // aircraft right, so it must crab left (heading < 360, i.e. toward the west)
    const wind = { wx: 30, wy: 0 } // 30 kt toward the east
    const hdg = windCorrectedHeadingTrue(0, wind, 100)
    const signed = ((hdg + 180) % 360) - 180 // -> small negative
    expect(signed).toBeCloseTo(-Math.asin(30 / 100) * (180 / Math.PI), 1)
  })

  it('crabs the opposite way for the opposite crosswind', () => {
    const left = windCorrectedHeadingTrue(0, { wx: 30, wy: 0 }, 100)
    const right = windCorrectedHeadingTrue(0, { wx: -30, wy: 0 }, 100)
    const sLeft = ((left + 180) % 360) - 180
    const sRight = ((right + 180) % 360) - 180
    expect(Math.sign(sLeft)).toBe(-Math.sign(sRight))
    expect(Math.abs(sLeft)).toBeCloseTo(Math.abs(sRight), 5)
  })
})

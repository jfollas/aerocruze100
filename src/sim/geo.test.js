import { describe, it, expect } from 'vitest'
import {
  ARP,
  FIXES,
  FIX_XY,
  project,
  nmBetween,
  bearingToTrue,
  magToTrue,
  trueToMag,
  TDZE,
  AP_MIN_MSL,
} from './geo.js'

describe('geo projection', () => {
  it('projects the ARP to the origin', () => {
    const p = project(ARP.lat, ARP.lon)
    expect(p.x).toBeCloseTo(0, 6)
    expect(p.y).toBeCloseTo(0, 6)
  })

  it('places the fixes consistently with the projected helpers', () => {
    // round-trip: project(FIXES.ZIMBO) === FIX_XY.ZIMBO
    const z = project(FIXES.ZIMBO.lat, FIXES.ZIMBO.lon)
    expect(z.x).toBeCloseTo(FIX_XY.ZIMBO.x, 9)
    expect(z.y).toBeCloseTo(FIX_XY.ZIMBO.y, 9)
  })
})

describe('approach geometry matches the plate', () => {
  it('ZIMBO -> RW10 is ~4.9 nm on ~090 true', () => {
    const d = nmBetween(FIX_XY.ZIMBO, FIX_XY.RW10)
    expect(d).toBeGreaterThan(4.6)
    expect(d).toBeLessThan(5.2)
    const brg = bearingToTrue(FIX_XY.ZIMBO, FIX_XY.RW10)
    expect(brg).toBeGreaterThan(86)
    expect(brg).toBeLessThan(94)
  })

  it('UBAYA -> ZIMBO is ~6.3 nm on ~090 true', () => {
    const d = nmBetween(FIX_XY.UBAYA, FIX_XY.ZIMBO)
    expect(d).toBeGreaterThan(6.0)
    expect(d).toBeLessThan(6.5)
    const brg = bearingToTrue(FIX_XY.UBAYA, FIX_XY.ZIMBO)
    expect(brg).toBeGreaterThan(86)
    expect(brg).toBeLessThan(94)
  })

  it('LEYIR is the north arm, WUDAT the south arm of UBAYA', () => {
    expect(bearingToTrue(FIX_XY.LEYIR, FIX_XY.UBAYA)).toBeCloseTo(180, -1) // ~180
    expect(bearingToTrue(FIX_XY.WUDAT, FIX_XY.UBAYA)).toBeLessThan(20) // ~0/360
  })
})

describe('magnetic/true conversions', () => {
  it('096 magnetic final ~= 090 true with 6W variation', () => {
    expect(magToTrue(96)).toBeCloseTo(90, 6)
    expect(trueToMag(90)).toBeCloseTo(96, 6)
  })
})

describe('autopilot floor', () => {
  it('700 AGL floor is TDZE + 700', () => {
    expect(AP_MIN_MSL).toBe(TDZE + 700)
  })
})

// Registration of the full FAA RNAV (GPS) RWY 10 plate (entire PDF page,
// rendered at 4×) to the local nautical-mile frame defined in geo.js. The
// affine below was fit (least squares) from the detected pixel centres of
// LEYIR / UBAYA / ZIMBO / WUDAT on the rendered page; residuals are a few px
// (~0.1 nm) — within the "approximate" registration the visualization needs.
//
//   [u]   [a b c]   [x_east_nm]
//   [v] = [d e f] · [y_north_nm]
//                   [    1     ]

export const PLAN_CHART = {
  src: '1g0-rnav10-full.webp',
  W: 1549,
  H: 2376,
  // fit from the fix diamond centres (located via the leg-line intersections,
  // text-free); residuals ~1–2 px
  a: 41.7077,
  b: -0.4798,
  c: 790.0392,
  d: -0.0999,
  e: -41.7992,
  f: 986.2776,
  // icon scale (viewBox units) so the aircraft reads at this page resolution
  planeScale: 4.6,
}

// Map a {x, y} position (nm east/north of the field) to {u, v} pixels on the
// chart page.
export function worldToChart(x, y) {
  const c = PLAN_CHART
  return { u: c.a * x + c.b * y + c.c, v: c.d * x + c.e * y + c.f }
}

// The plate's profile section, registered in the SAME full-page pixel frame as
// the plan view above. It is NOT to scale, so the horizontal axis is
// interpolated piecewise between the depicted fixes (by distance to the
// threshold) and the vertical axis is mapped linearly by altitude between the
// 2300 ft level line and the runway (673 ft). Used to overlay the aircraft and
// the 700-AGL floor onto the profile drawn on the plate.
export const PROFILE_CHART = {
  // distance-to-threshold (nm) -> page pixel x, anchored on the depicted fixes
  distAnchors: [
    { nm: 11.2, u: 362 }, // UBAYA
    { nm: 4.9, u: 555 }, // ZIMBO (FAF)
    { nm: 1.4, u: 777 }, // missed-approach point
    { nm: 0, u: 875 }, // RW10 threshold
  ],
  // altitude (ft) -> page pixel y, linear
  alt0: 2300,
  v0: 1807,
  alt1: 673,
  v1: 1952,
  // horizontal extent of the profile graphic (for the floor line)
  xLeft: 130,
  xRight: 905,
}

// Piecewise-linear distance(nm)→x; extrapolates past the end anchors.
export function profileX(nm) {
  const A = PROFILE_CHART.distAnchors // nm descending, u ascending
  if (nm >= A[0].nm) {
    const s = (A[1].u - A[0].u) / (A[1].nm - A[0].nm)
    return A[0].u + (nm - A[0].nm) * s
  }
  for (let i = 0; i < A.length - 1; i++) {
    if (nm <= A[i].nm && nm >= A[i + 1].nm) {
      const f = (A[i].nm - nm) / (A[i].nm - A[i + 1].nm)
      return A[i].u + f * (A[i + 1].u - A[i].u)
    }
  }
  const n = A.length
  const s = (A[n - 1].u - A[n - 2].u) / (A[n - 1].nm - A[n - 2].nm)
  return A[n - 1].u + (nm - A[n - 1].nm) * s
}

// Linear altitude(ft)→y between the 2300 line and the runway.
export function profileY(alt) {
  const c = PROFILE_CHART
  return c.v0 + ((c.alt0 - alt) / (c.alt0 - c.alt1)) * (c.v1 - c.v0)
}

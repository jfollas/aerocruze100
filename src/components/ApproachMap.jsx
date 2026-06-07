import { PLAN_CHART, worldToChart, PROFILE_CHART, profileX, profileY } from '../sim/chart.js'
import { magToTrue, FIX_XY, nmBetween, AP_MIN_MSL } from '../sim/geo.js'
import { PLANS } from '../sim/navplan.js'

// Top-down airplane planform, centred at the origin, nose pointing up (-y).
const PLANE =
  'M0 -11 L1.8 -6 L1.8 -1.4 L8.4 2.1 L8.4 3.5 L2.1 2.8 L1.8 7 ' +
  'L4.2 9.8 L4.2 10.9 L1.4 11.2 L0 11.6 L-1.4 11.2 L-4.2 10.9 L-4.2 9.8 ' +
  'L-1.8 7 L-2.1 2.8 L-8.4 3.5 L-8.4 2.1 L-1.8 -1.4 L-1.8 -6 Z'

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x))
const toRad = (d) => (d * Math.PI) / 180

// chart scale (pixels per nm) and the standard-rate fly-by turn radius (~150 kt)
const PX_PER_NM = Math.hypot(PLAN_CHART.a, PLAN_CHART.d)
const FLYBY_R = 0.8 * PX_PER_NM

// Round fly-by corners: replace a sharp interior waypoint (e.g. UBAYA on the
// LEYIR/WUDAT arms) with the two tangent points of a standard-rate turn, so the
// drawn course cuts the corner the way the GPSS autopilot actually flies it.
// Gentle bends (the hold-entry arcs, the straight-in) are left untouched.
function cutCorners(pts) {
  if (pts.length < 3) return pts
  const out = [pts[0]]
  for (let i = 1; i < pts.length - 1; i++) {
    const P = pts[i]
    const a = { x: pts[i - 1].u - P.u, y: pts[i - 1].v - P.v }
    const c = { x: pts[i + 1].u - P.u, y: pts[i + 1].v - P.v }
    const la = Math.hypot(a.x, a.y)
    const lc = Math.hypot(c.x, c.y)
    if (la < 1 || lc < 1) {
      out.push(P)
      continue
    }
    const ua = { x: a.x / la, y: a.y / la }
    const uc = { x: c.x / lc, y: c.y / lc }
    const alpha = Math.acos(clamp(ua.x * uc.x + ua.y * uc.y, -1, 1)) // opening angle at P
    // only round a sharp corner (>60° turn) with room on both legs — this picks
    // the LEYIR/WUDAT turn onto final but leaves the hold-entry fix crossings,
    // where you cross UBAYA rather than cut it, alone
    if (alpha < toRad(120) && la > FLYBY_R * 1.2 && lc > FLYBY_R * 1.2) {
      const tan = Math.min(FLYBY_R / Math.tan(alpha / 2), la * 0.45, lc * 0.45)
      out.push({ u: P.u + ua.x * tan, v: P.v + ua.y * tan }) // tangent point on the inbound leg
      out.push({ u: P.u + uc.x * tan, v: P.v + uc.y * tan }) // tangent point on the outbound leg
    } else {
      out.push(P)
    }
  }
  out.push(pts[pts.length - 1])
  return out
}

// Build a smooth SVG path through {u,v} points with a centripetal Catmull-Rom
// spline (alpha = 0.5). The course passes through every waypoint, but the
// course-reversal turns at UBAYA render as curves/half-circles instead of the
// triangular intercepts you get from straight segments.
function smoothPath(pts) {
  const n = pts.length
  if (n < 3) return pts.map((p, i) => (i ? 'L' : 'M') + p.u + ' ' + p.v).join(' ')
  const dist = (a, b) => Math.max(Math.hypot(b.u - a.u, b.v - a.v), 1e-4)
  let d = `M${pts[0].u} ${pts[0].v}`
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[i === 0 ? 0 : i - 1]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2 >= n ? n - 1 : i + 2]
    const t0 = 0
    const t1 = t0 + Math.sqrt(dist(p0, p1))
    const t2 = t1 + Math.sqrt(dist(p1, p2))
    const t3 = t2 + Math.sqrt(dist(p2, p3))
    const seg = t2 - t1
    const m1u = seg * ((p1.u - p0.u) / (t1 - t0) - (p2.u - p0.u) / (t2 - t0) + (p2.u - p1.u) / seg)
    const m1v = seg * ((p1.v - p0.v) / (t1 - t0) - (p2.v - p0.v) / (t2 - t0) + (p2.v - p1.v) / seg)
    const m2u = seg * ((p2.u - p1.u) / seg - (p3.u - p1.u) / (t3 - t1) + (p3.u - p2.u) / (t3 - t2))
    const m2v = seg * ((p2.v - p1.v) / seg - (p3.v - p1.v) / (t3 - t1) + (p3.v - p2.v) / (t3 - t2))
    d += ` C${p1.u + m1u / 3} ${p1.v + m1v / 3} ${p2.u - m2u / 3} ${p2.v - m2v / 3} ${p2.u} ${p2.v}`
  }
  return d
}

// The to-scale plan view: the entire FAA RNAV (GPS) RWY 10 plate, with the
// simulated aircraft drawn on the plan view (georeferenced) and again on the
// plate's profile section (interpolated), plus the 700-AGL autopilot floor.
export default function ApproachMap({ state }) {
  const { W, H } = PLAN_CHART
  const img = `${import.meta.env.BASE_URL}${PLAN_CHART.src}`

  let plan = null
  let prof = null
  if (state.scenarioActive) {
    // plan-view aircraft (georeferenced)
    const { u, v } = worldToChart(state.curX, state.curY)
    const t = toRad(magToTrue(state.curTrack))
    const du = PLAN_CHART.a * Math.sin(t) + PLAN_CHART.b * Math.cos(t)
    const dv = PLAN_CHART.d * Math.sin(t) + PLAN_CHART.e * Math.cos(t)
    plan = {
      x: clamp(u, 10, W - 10),
      y: clamp(v, 10, H - 10),
      rot: (Math.atan2(du, -dv) * 180) / Math.PI,
      off: u < 0 || u > W || v < 0 || v > H,
    }
    // profile-section aircraft (interpolated by distance & altitude)
    const dThr = nmBetween({ x: state.curX, y: state.curY }, FIX_XY.RW10)
    prof = {
      x: clamp(profileX(dThr), 8, W - 8),
      y: clamp(profileY(state.curAlt), 8, H - 8),
      rot: state.curVS < -50 ? 113 : state.curVS > 50 ? 67 : 90,
    }
  }

  const floorY = profileY(AP_MIN_MSL)

  // The loaded procedure track, drawn over the plan view as a magenta course
  // line (including any course-reversal / hold-entry shape at UBAYA).
  const coursePlan = state.scenarioActive && state.scenarioIaf && PLANS[state.scenarioIaf]
  const course = coursePlan ? smoothPath(cutCorners(coursePlan.map((wp) => worldToChart(wp.x, wp.y)))) : null

  return (
    <div className="apch-map">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="RNAV (GPS) RWY 10 plate">
        <image href={img} x="0" y="0" width={W} height={H} />
        {/* 700-AGL autopilot floor across the profile section */}
        <line className="apch-floor" x1={PROFILE_CHART.xLeft} y1={floorY} x2={PROFILE_CHART.xRight} y2={floorY} />
        {course && <path className="apch-course" d={course} />}
        {plan && (
          <g transform={`translate(${plan.x} ${plan.y}) rotate(${plan.rot}) scale(${PLAN_CHART.planeScale})`} className={plan.off ? 'apch-plane off' : 'apch-plane'}>
            <path d={PLANE} />
          </g>
        )}
        {prof && (
          <g transform={`translate(${prof.x} ${prof.y}) rotate(${prof.rot}) scale(3.2)`} className="apch-plane">
            <path d={PLANE} />
          </g>
        )}
      </svg>
    </div>
  )
}

import { PLAN_CHART, worldToChart, PROFILE_CHART, profileX, profileY } from '../sim/chart.js'
import { magToTrue, FIX_XY, nmBetween, AP_MIN_MSL } from '../sim/geo.js'

// Top-down airplane planform, centred at the origin, nose pointing up (-y).
const PLANE =
  'M0 -11 L1.8 -6 L1.8 -1.4 L8.4 2.1 L8.4 3.5 L2.1 2.8 L1.8 7 ' +
  'L4.2 9.8 L4.2 10.9 L1.4 11.2 L0 11.6 L-1.4 11.2 L-4.2 10.9 L-4.2 9.8 ' +
  'L-1.8 7 L-2.1 2.8 L-8.4 3.5 L-8.4 2.1 L-1.8 -1.4 L-1.8 -6 Z'

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x))
const toRad = (d) => (d * Math.PI) / 180

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

  return (
    <div className="apch-map">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="RNAV (GPS) RWY 10 plate">
        <image href={img} x="0" y="0" width={W} height={H} />
        {/* 700-AGL autopilot floor across the profile section */}
        <line className="apch-floor" x1={PROFILE_CHART.xLeft} y1={floorY} x2={PROFILE_CHART.xRight} y2={floorY} />
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

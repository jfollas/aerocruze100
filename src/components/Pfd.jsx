import { useRef } from 'react'
import { mod360 } from '../sim/flight.js'
import '../styles/pfd.css'

// A compact glass-cockpit PFD loosely based on the Dynon SkyView: attitude
// indicator with a speed tape (left) and altitude + vertical-speed tapes
// (right), and an HSI below. The heading / altitude / VS bugs are set by
// dragging directly on the gauges (scroll-wheel nudges them too) and write the
// same state the SkyView feeds the autopilot (svHeadingBug / svAltBug /
// svAltBugSet / svVsBug). A button cycles the CDI source.

// ---- layout (SVG viewBox units) ----
const VB_W = 340
const VB_H = 384
const TOP = 6
const BOT = 196
const H = BOT - TOP
const YC = (TOP + BOT) / 2

const SPD_X = 4
const SPD_W = 42
const ATT_X = 48
const ATT_W = 190
const AX = ATT_X + ATT_W / 2 // attitude center x
const ALT_X = 242
const ALT_W = 58
const VS_X = 302
const VS_W = 34

const HSI_CX = VB_W / 2
const HSI_CY = 294
const HSI_R = 84

// LPV glideslope indicator (vertical), sits just right of the HSI ring
const GSI_X = HSI_CX + HSI_R + 18
// 2 dots each side, so the box (4 dots) spans 75% of the HSI diameter
const GSI_DOT = 0.375 * HSI_R // px from centre to the box edge per dot
// dots/line travel sit 10% in from the box ends, so the outer dots are contained
const GSI_PITCH = 0.8 * GSI_DOT

// scales
const PPK = 2.4 // px per knot
const PPF = 0.18 // px per foot
const PPV = 0.0425 // px per fpm
const PP_PITCH = 2.6 // px per degree of pitch

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x))
const round = (x, s) => Math.round(x / s) * s
const range = (a, b, step) => {
  const out = []
  for (let v = a; v <= b + 1e-6; v += step) out.push(Math.round(v))
  return out
}
const polar = (cx, cy, r, deg) => {
  const a = ((deg - 90) * Math.PI) / 180
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
}

// Small vertical notched-rectangle bug for a tape: the notch is cut into the
// inner (right) edge so it faces into the tape and seats over the numeric value
// flag when the bug matches the current value.
const tapeBug = (x0, y, w, h, n) => {
  const t = y - h / 2
  const bm = y + h / 2
  const xr = x0 + w
  return `M${x0} ${t} L${xr} ${t} L${xr} ${y - n} L${xr - n} ${y} L${xr} ${y + n} L${xr} ${bm} L${x0} ${bm} Z`
}

// Notched-rectangle bug for the HSI rim: the notch is cut into the outer (top)
// edge so it faces away from the centre of the ring.
const ringBug = (cx, top, w, h, n) => {
  const l = cx - w / 2
  const r = cx + w / 2
  const bot = top + h
  return `M${l} ${top} L${cx - n} ${top} L${cx} ${top + n} L${cx + n} ${top} L${r} ${top} L${r} ${bot} L${l} ${bot} Z`
}

export default function Pfd({ state, actions }) {
  const set = actions.setConfig
  const svgRef = useRef(null)
  const drag = useRef(null)

  const { curIAS, curAlt, curVS, pitch, bankAngle, curTrack } = state
  const { svHeadingBug, svAltBug, svAltBugSet, svVsBug, skyviewCdi } = state
  const { approachActive, gsDev, lpvPhase } = state
  // GSI appears once established on the approach course (glideslope armed/coupled)
  const showGs = approachActive && skyviewCdi === 'flightplan' && (lpvPhase === 'ARM' || lpvPhase === 'CPLD')
  const gsLabel = lpvPhase === 'CPLD' ? 'GS CPLD' : 'GS ARM'
  const gsY = HSI_CY - clamp(gsDev || 0, -2, 2) * GSI_PITCH
  const live = state.skyview === 'on' // bugs actually drive the AP

  // pointer -> viewBox coordinates
  const toSvg = (e) => {
    const r = svgRef.current.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * VB_W, y: ((e.clientY - r.top) / r.height) * VB_H }
  }
  const applyHdg = (p) => {
    const ang = (Math.atan2(p.x - HSI_CX, -(p.y - HSI_CY)) * 180) / Math.PI
    set({ svHeadingBug: Math.round(mod360(curTrack + ang)) })
  }
  const handlers = (kind) => ({
    onPointerDown: (e) => {
      e.currentTarget.setPointerCapture?.(e.pointerId)
      const p = toSvg(e)
      drag.current = { kind, y0: p.y, alt0: svAltBug, vs0: svVsBug }
      if (kind === 'hdg') applyHdg(p)
    },
    onPointerMove: (e) => {
      const d = drag.current
      if (!d || d.kind !== kind) return
      const p = toSvg(e)
      if (kind === 'alt') set({ svAltBug: clamp(round(d.alt0 - (p.y - d.y0) / PPF, 100), 0, 17500), svAltBugSet: true })
      else if (kind === 'vs') set({ svVsBug: clamp(round(d.vs0 - (p.y - d.y0) / PPV, 100), -1500, 1500) })
      else if (kind === 'hdg') applyHdg(p)
    },
    onPointerUp: (e) => {
      drag.current = null
      e.currentTarget.releasePointerCapture?.(e.pointerId)
    },
    onPointerCancel: () => (drag.current = null),
  })
  const wheel = (kind) => (e) => {
    if (kind === 'alt') set({ svAltBug: clamp(round(svAltBug - Math.sign(e.deltaY) * 100, 100), 0, 17500), svAltBugSet: true })
    else if (kind === 'vs') set({ svVsBug: clamp(round(svVsBug - Math.sign(e.deltaY) * 100, 100), -1500, 1500) })
    else if (kind === 'hdg') set({ svHeadingBug: Math.round(mod360(svHeadingBug - Math.sign(e.deltaY))) })
  }

  const cdiSources = ['heading', 'flightplan', 'navaid']
  const cdiLabel = { heading: 'HDG', flightplan: 'GPS', navaid: 'NAV' }[skyviewCdi]
  const cdiColor = { flightplan: '#e641d6', navaid: '#28d07a' }[skyviewCdi] // GPS magenta, NAV green
  const showCdi = skyviewCdi !== 'heading' // HDG mode has no course needle
  // The course needle points along the active GPS flight-plan leg (its desired
  // track), which is independent of the heading bug; it falls back to the bug
  // when no flight-plan course is available.
  const cdiCourse = skyviewCdi === 'flightplan' && state.gpsDtk != null ? state.gpsDtk : svHeadingBug
  const cycleCdi = () => set({ skyviewCdi: cdiSources[(cdiSources.indexOf(skyviewCdi) + 1) % cdiSources.length] })

  // bug Y positions (clamped to the tape so an off-scale bug parks at the edge)
  const altBugY = clamp(YC + (curAlt - svAltBug) * PPF, TOP + 6, BOT - 6)
  const vsBugY = clamp(YC - svVsBug * PPV, TOP + 6, BOT - 6)
  const vsY = clamp(YC - curVS * PPV, TOP + 4, BOT - 4)

  return (
    <div className={'pfd' + (state.power === 'off' ? ' pfd-off' : '')}>
      <svg ref={svgRef} className="pfd-svg" viewBox={`0 0 ${VB_W} ${VB_H}`} role="img" aria-label="Primary flight display">
        <defs>
          <clipPath id="attClip">
            <rect x={ATT_X} y={TOP} width={ATT_W} height={H} rx="6" />
          </clipPath>
          <clipPath id="spdClip">
            <rect x={SPD_X} y={TOP} width={SPD_W} height={H} />
          </clipPath>
          <clipPath id="altClip">
            <rect x={ALT_X} y={TOP} width={ALT_W} height={H} />
          </clipPath>
        </defs>

        {/* ===== Attitude ===== */}
        <g clipPath="url(#attClip)">
          <g transform={`translate(${AX} ${YC}) rotate(${-bankAngle}) translate(0 ${pitch * PP_PITCH})`}>
            <rect x="-260" y="-460" width="520" height="460" fill="#2b7fd6" />
            <rect x="-260" y="0" width="520" height="460" fill="#7a5326" />
            <line x1="-260" y1="0" x2="260" y2="0" stroke="#eaf2ff" strokeWidth="1.4" />
            {[5, 10, 15, 20].flatMap((p) =>
              [p, -p].map((pp) => {
                const y = -pp * PP_PITCH
                const w = pp % 10 === 0 ? 26 : 14
                return (
                  <g key={pp}>
                    <line x1={-w} y1={y} x2={w} y2={y} stroke="#dce8fb" strokeWidth="1" />
                    {pp % 10 === 0 && (
                      <>
                        <text x={-w - 4} y={y + 3} className="pfd-ladder" textAnchor="end">{Math.abs(pp)}</text>
                        <text x={w + 4} y={y + 3} className="pfd-ladder" textAnchor="start">{Math.abs(pp)}</text>
                      </>
                    )}
                  </g>
                )
              })
            )}
          </g>
        </g>
        {/* roll arc (fixed) + bank pointer (rolls) */}
        <g>
          {[-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60].map((a) => {
            const [x1, y1] = polar(AX, YC, HSI_R * 0.92, a)
            const [x2, y2] = polar(AX, YC, HSI_R * 0.92 - (a % 30 === 0 ? 8 : 5), a)
            return <line key={a} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#cfe0f5" strokeWidth="1" />
          })}
          <polygon points={`${AX - 5},${YC - HSI_R * 0.92 + 1} ${AX + 5},${YC - HSI_R * 0.92 + 1} ${AX},${YC - HSI_R * 0.92 + 11}`} fill="#ffd23f" />
          <g transform={`rotate(${-bankAngle} ${AX} ${YC})`}>
            <polygon points={`${AX},${YC - HSI_R * 0.92 + 13} ${AX - 6},${YC - HSI_R * 0.92 + 25} ${AX + 6},${YC - HSI_R * 0.92 + 25}`} fill="#eef5ff" />
          </g>
        </g>
        {/* fixed aircraft reference */}
        <g stroke="#ffd23f" strokeWidth="3" fill="none">
          <path d={`M${AX - 46} ${YC} h22 l6 8`} />
          <path d={`M${AX + 46} ${YC} h-22 l-6 8`} />
          <circle cx={AX} cy={YC} r="2.2" fill="#ffd23f" stroke="none" />
        </g>
        <rect x={ATT_X} y={TOP} width={ATT_W} height={H} rx="6" className="pfd-frame" />

        {/* ===== Speed tape ===== */}
        <rect x={SPD_X} y={TOP} width={SPD_W} height={H} className="pfd-tape" />
        <g clipPath="url(#spdClip)">
          {range(Math.floor((curIAS - 38) / 5) * 5, Math.ceil((curIAS + 38) / 5) * 5, 5)
            .filter((v) => v >= 0)
            .map((v) => {
              const y = YC + (curIAS - v) * PPK
              const major = v % 10 === 0
              return (
                <g key={v}>
                  <line x1={SPD_X + SPD_W - (major ? 10 : 6)} y1={y} x2={SPD_X + SPD_W} y2={y} stroke="#9fb2c9" strokeWidth="1" />
                  {major && <text x={SPD_X + SPD_W - 12} y={y + 3.5} className="pfd-tick" textAnchor="end">{v}</text>}
                </g>
              )
            })}
        </g>
        <g>
          <polygon
            points={`${SPD_X},${YC - 9} ${SPD_X + SPD_W - 8},${YC - 9} ${SPD_X + SPD_W},${YC} ${SPD_X + SPD_W - 8},${YC + 9} ${SPD_X},${YC + 9}`}
            className="pfd-readout"
          />
          <text x={SPD_X + SPD_W - 6} y={YC + 4} className="pfd-readout-val" textAnchor="end">{Math.round(curIAS)}</text>
        </g>

        {/* ===== Altitude tape ===== */}
        <rect x={ALT_X} y={TOP} width={ALT_W} height={H} className="pfd-tape" {...handlers('alt')} onWheel={wheel('alt')} style={{ cursor: 'ns-resize' }} />
        <g clipPath="url(#altClip)" pointerEvents="none">
          {range(Math.floor((curAlt - 520) / 100) * 100, Math.ceil((curAlt + 520) / 100) * 100, 100).map((v) => {
            const y = YC + (curAlt - v) * PPF
            return (
              <g key={v}>
                <line x1={ALT_X} y1={y} x2={ALT_X + 8} y2={y} stroke="#9fb2c9" strokeWidth="1" />
                <text x={ALT_X + 12} y={y + 3.5} className="pfd-tick" textAnchor="start">{v}</text>
              </g>
            )
          })}
        </g>
        {/* altitude bug — small vertical marker, notch on the inner side */}
        {svAltBugSet && <path d={tapeBug(ALT_X, altBugY, 9, 18, 5)} className="pfd-bug" pointerEvents="none" />}
        {/* numeric value flag — its pointer apex matches the bug notch (ALT_X+4) */}
        <g pointerEvents="none">
          <polygon
            points={`${ALT_X + ALT_W},${YC - 10} ${ALT_X + 11},${YC - 10} ${ALT_X + 4},${YC} ${ALT_X + 11},${YC + 10} ${ALT_X + ALT_W},${YC + 10}`}
            className="pfd-readout"
          />
          <text x={ALT_X + ALT_W - 4} y={YC + 4} className="pfd-readout-val" textAnchor="end">{Math.round(curAlt)}</text>
        </g>

        {/* ===== Vertical speed tape ===== */}
        <rect x={VS_X} y={TOP} width={VS_W} height={H} className="pfd-tape" {...handlers('vs')} onWheel={wheel('vs')} style={{ cursor: 'ns-resize' }} />
        <g pointerEvents="none">
          {[500, 1000, 1500, 2000].flatMap((m) => [m, -m]).map((v) => {
            const y = YC - v * PPV
            return (
              <g key={v}>
                <line x1={VS_X} y1={y} x2={VS_X + (Math.abs(v) % 1000 === 0 ? 9 : 5)} y2={y} stroke="#9fb2c9" strokeWidth="1" />
                {Math.abs(v) % 1000 === 0 && <text x={VS_X + VS_W - 2} y={y + 3} className="pfd-tick-sm" textAnchor="end">{Math.abs(v / 1000)}</text>}
              </g>
            )
          })}
          <line x1={VS_X} y1={YC} x2={VS_X + VS_W} y2={YC} stroke="#6b7c91" strokeWidth="1" />
          {/* current-VS value flag — its pointer apex (VS_X+5) matches the bug notch */}
          <polygon
            points={`${VS_X + VS_W},${vsY - 9} ${VS_X + 12},${vsY - 9} ${VS_X + 5},${vsY} ${VS_X + 12},${vsY + 9} ${VS_X + VS_W},${vsY + 9}`}
            className="pfd-readout"
          />
          <text x={VS_X + VS_W - 3} y={vsY + 3} className="pfd-readout-vs" textAnchor="end">{Math.round(curVS)}</text>
          {/* VS bug — small vertical marker, notch on the inner side */}
          <path d={tapeBug(VS_X, vsBugY, 9, 16, 4)} className="pfd-bug" />
        </g>

        {/* ===== HSI ===== */}
        <circle cx={HSI_CX} cy={HSI_CY} r={HSI_R + 4} className="pfd-hsi-bg" />
        <g {...handlers('hdg')} onWheel={wheel('hdg')} style={{ cursor: 'grab' }}>
          <circle cx={HSI_CX} cy={HSI_CY} r={HSI_R} fill="transparent" />
          {/* rotating compass card */}
          <g transform={`rotate(${-curTrack} ${HSI_CX} ${HSI_CY})`} pointerEvents="none">
            {range(0, 350, 10).map((a) => {
              const major = a % 30 === 0
              const [x1, y1] = polar(HSI_CX, HSI_CY, HSI_R, a)
              const [x2, y2] = polar(HSI_CX, HSI_CY, HSI_R - (major ? 9 : 5), a)
              return <line key={a} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#b9c8db" strokeWidth={major ? 1.3 : 0.8} />
            })}
            {[['N', 0], ['3', 30], ['6', 60], ['E', 90], ['12', 120], ['15', 150], ['S', 180], ['21', 210], ['24', 240], ['W', 270], ['30', 300], ['33', 330]].map(([lbl, a]) => {
              const [tx, ty] = polar(HSI_CX, HSI_CY, HSI_R - 18, a)
              return (
                <text key={a} x={tx} y={ty + 4} className="pfd-rose" textAnchor="middle" transform={`rotate(${a} ${tx} ${ty})`}>{lbl}</text>
              )
            })}
            {/* heading bug — rides just inside the ring, outer edge tangent to it */}
            <g transform={`rotate(${svHeadingBug} ${HSI_CX} ${HSI_CY})`}>
              <path d={ringBug(HSI_CX, HSI_CY - HSI_R, 16, 10, 5)} className="pfd-bug" />
            </g>
            {/* course / CDI needle (points along the active GPS leg / DTK, or the
                heading bug for other sources); hidden in HDG mode */}
            {showCdi && (
              <g transform={`rotate(${cdiCourse} ${HSI_CX} ${HSI_CY})`}>
                <line x1={HSI_CX} y1={HSI_CY - HSI_R + 14} x2={HSI_CX} y2={HSI_CY - 22} className="pfd-cdi" style={{ stroke: cdiColor }} />
                <line x1={HSI_CX} y1={HSI_CY + 22} x2={HSI_CX} y2={HSI_CY + HSI_R - 14} className="pfd-cdi" style={{ stroke: cdiColor }} />
                <polygon points={`${HSI_CX},${HSI_CY - HSI_R + 6} ${HSI_CX - 5},${HSI_CY - HSI_R + 16} ${HSI_CX + 5},${HSI_CY - HSI_R + 16}`} className="pfd-cdi-fill" style={{ fill: cdiColor }} />
              </g>
            )}
          </g>
          {/* fixed aircraft — solid white top-down planform */}
          <path
            d={`M${HSI_CX} ${HSI_CY - 16}
                L${HSI_CX + 2.5} ${HSI_CY - 9} L${HSI_CX + 2.5} ${HSI_CY - 2}
                L${HSI_CX + 12} ${HSI_CY + 3} L${HSI_CX + 12} ${HSI_CY + 5} L${HSI_CX + 3} ${HSI_CY + 4}
                L${HSI_CX + 2.5} ${HSI_CY + 10}
                L${HSI_CX + 6} ${HSI_CY + 14} L${HSI_CX + 6} ${HSI_CY + 15.5} L${HSI_CX + 2} ${HSI_CY + 16}
                L${HSI_CX} ${HSI_CY + 16.5}
                L${HSI_CX - 2} ${HSI_CY + 16} L${HSI_CX - 6} ${HSI_CY + 15.5} L${HSI_CX - 6} ${HSI_CY + 14}
                L${HSI_CX - 2.5} ${HSI_CY + 10}
                L${HSI_CX - 3} ${HSI_CY + 4} L${HSI_CX - 12} ${HSI_CY + 5} L${HSI_CX - 12} ${HSI_CY + 3}
                L${HSI_CX - 2.5} ${HSI_CY - 2} L${HSI_CX - 2.5} ${HSI_CY - 9} Z`}
            fill="#f4f8ff"
            stroke="#0a0d11"
            strokeWidth="0.8"
            strokeLinejoin="round"
            pointerEvents="none"
          />
        </g>
        {/* heading flag — readout box and notch-filling pointer as one continuous shape */}
        <g pointerEvents="none">
          <path
            d={`M${HSI_CX - 20} ${HSI_CY - HSI_R - 22}
                L${HSI_CX + 20} ${HSI_CY - HSI_R - 22}
                Q${HSI_CX + 22} ${HSI_CY - HSI_R - 22} ${HSI_CX + 22} ${HSI_CY - HSI_R - 20}
                L${HSI_CX + 22} ${HSI_CY - HSI_R - 7}
                Q${HSI_CX + 22} ${HSI_CY - HSI_R - 5} ${HSI_CX + 20} ${HSI_CY - HSI_R - 5}
                L${HSI_CX + 10} ${HSI_CY - HSI_R - 5}
                L${HSI_CX} ${HSI_CY - HSI_R + 5}
                L${HSI_CX - 10} ${HSI_CY - HSI_R - 5}
                L${HSI_CX - 20} ${HSI_CY - HSI_R - 5}
                Q${HSI_CX - 22} ${HSI_CY - HSI_R - 5} ${HSI_CX - 22} ${HSI_CY - HSI_R - 7}
                L${HSI_CX - 22} ${HSI_CY - HSI_R - 20}
                Q${HSI_CX - 22} ${HSI_CY - HSI_R - 22} ${HSI_CX - 20} ${HSI_CY - HSI_R - 22} Z`}
            className="pfd-readout"
          />
          <text x={HSI_CX} y={HSI_CY - HSI_R - 9} className="pfd-readout-val" textAnchor="middle">{String(Math.round(mod360(curTrack))).padStart(3, '0')}</text>
        </g>

        {/* ===== LPV glideslope (vertical guidance) ===== */}
        {showGs && (
          <g pointerEvents="none">
            <text x={GSI_X} y={HSI_CY - 2 * GSI_DOT - 8} className="pfd-gsi-lbl" textAnchor="middle">G/S</text>
            <rect x={GSI_X - 6} y={HSI_CY - 2 * GSI_DOT} width="12" height={4 * GSI_DOT} rx="2" className="pfd-gsi-scale" />
            {[-2, -1, 1, 2].map((d) => (
              <circle key={d} cx={GSI_X} cy={HSI_CY - d * GSI_PITCH} r="2.4" className="pfd-gsi-dot" />
            ))}
            {/* fixed white centre reference */}
            <line x1={GSI_X - 4.5} y1={HSI_CY} x2={GSI_X + 4.5} y2={HSI_CY} className="pfd-gsi-ctr" />
            {/* moving magenta glideslope */}
            <line x1={GSI_X - 4.5} y1={gsY} x2={GSI_X + 4.5} y2={gsY} className="pfd-gsi-gs" />
            {/* vertical-mode annunciation */}
            <text x={GSI_X} y={HSI_CY + 2 * GSI_DOT + 13} className="pfd-gsi-ann" textAnchor="middle">{gsLabel}</text>
          </g>
        )}
      </svg>

      <div className="pfd-controls">
        <div className="pfd-chips">
          <button className="pfd-chip pfd-chip-hdg" onClick={cycleCdi} title="Cycle CDI source">
            <span className="pfd-chip-lbl">CDI</span>
            <span className="pfd-chip-val">{cdiLabel}</span>
          </button>
          <div className="pfd-chip">
            <span className="pfd-chip-lbl">HDG</span>
            <span className="pfd-chip-val">{String(Math.round(svHeadingBug)).padStart(3, '0')}°</span>
          </div>
          <button
            className={'pfd-chip pfd-chip-btn' + (svAltBugSet ? ' on' : '')}
            onClick={() => set({ svAltBugSet: !svAltBugSet })}
            title="Toggle the altitude bug"
          >
            <span className="pfd-chip-lbl">ALT</span>
            <span className="pfd-chip-val">{svAltBugSet ? svAltBug : '– – –'}</span>
          </button>
          <div className="pfd-chip">
            <span className="pfd-chip-lbl">VS</span>
            <span className="pfd-chip-val">{svVsBug > 0 ? '+' : ''}{svVsBug}</span>
          </div>
        </div>
        <p className="pfd-hint">
          Drag the HSI, alt &amp; VS tapes to set bugs{live ? '' : ' (select SkyView to feed the autopilot)'}.
        </p>
      </div>
    </div>
  )
}

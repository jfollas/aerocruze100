// Guided walkthrough lessons. Pure data + predicates over the reducer state —
// no React, no DOM — so they're importable and unit-testable. The tutorial UI
// (src/hooks/useTutorial.js, src/components/TutorialPanel.jsx) interprets these.
//
// A lesson: { id, title, blurb, init(actions), steps:[Step] }
// A Step:  {
//   id, prompt, highlight,          // highlight = a CONTROL_IDS member (or null)
//   check(state) -> bool,           // completion predicate (omit => a "notice" step, Next only)
//   setup(actions)?,                // run once on entering the step (arm a condition)
//   pause?,                         // freeze the sim clock while waiting (default true)
//   allowPreSatisfied?,             // advance even if check is already true on entry (observe steps)
//   note?,                          // teaching aside shown under the prompt
// }
//
// init/setup receive the memoized `actions` object (setConfig / button presses);
// they cannot reach into the reducer. Lessons never fake autopilot events — the
// user drives the real controls and the sim stays authoritative.

import { angleDiff } from './flight.js'

// The set of control ids a step may highlight (kept in sync with the data-ctl
// attributes on the components and the glow rules in styles/tutorial.css).
export const CONTROL_IDS = [
  'mode',
  'alt',
  'knob',
  'pwr',
  'cws',
  'level',
  'navSource',
  'lpvToggle',
  'gpsSignal',
  'windSlider',
  'bankSlider',
  'sensorBtn',
  'cdiSource',
  'altBug',
  'vsBug',
  'svHdgKnob',
  'svAltKnob',
  'iaf',
]

// nav-source config patches (mirror ConfigPanel.NAV_SOURCES)
const NAV_NONE = { gpsData: 'none', arinc: 'none', skyview: 'off' }
const NAV_430W = { gpsData: 'ifr', arinc: 'none', skyview: 'off' }

// Reset to a clean, powered-DOWN baseline with the lesson's config applied. The
// caller decides whether to power on (the startup lesson leaves it off so the
// user flips PWR; the others power on and boot during their first step). On boot
// the autopilot comes alive with the usual ~200 ft baro offset to sync.
function reset(actions, cfg = {}) {
  actions.setConfig({ power: 'off' })
  actions.setConfig({
    gpsStatus: 'OK',
    groundSpeed: 120,
    curTrack: 200,
    curAlt: 3000,
    curVS: 0,
    scenarioActive: false,
    approachActive: false,
    windDir: 270,
    windSpd: 0,
    skyviewCdi: 'heading',
    svHeadingBug: 160,
    svAltBug: 3500,
    svAltBugSet: true,
    svVsBug: 500,
    inducedBank: 0,
    warning: null,
    ...NAV_NONE,
    ...cfg,
  })
}

// shared step fragments -----------------------------------------------------
const bootStep = {
  id: 'boot',
  prompt: 'Powering up the autopilot — wait for it to finish booting.',
  highlight: null,
  pause: false, // the clock must run to finish the 3-second boot
  check: (s) => s.power === 'on',
}

const synced = (s) => Math.abs(s.altDelta) < 10

// Highlight helpers for compound steps: the focus moves from the ALT button (to
// open the screen) to the knob (to dial/confirm) as the screen state changes, so
// the glow tracks what the user should press next.
const altThenKnob = (s) => (s.screen === 'NORMAL' ? 'alt' : 'knob') // press ALT, then use the knob
const altSyncFocus = (s) => (s.screen === 'ALT_SYNC' ? 'knob' : 'alt') // press ALT twice, then the knob

// ALT SYNC (two steps): open the screen, then dial the offset to zero.
const altSyncSteps = (note) => [
  {
    id: 'altsync-open',
    prompt: 'Press ALT twice to reach the ALT SYNC screen.',
    note,
    highlight: 'alt',
    check: (s) => s.screen === 'ALT_SYNC',
  },
  {
    id: 'altsync-dial',
    prompt: 'Twist the knob until the reported altitude matches the PFD (offset ~0), then press the knob to confirm.',
    highlight: 'knob',
    check: (s) => synced(s) && s.screen === 'NORMAL',
  },
]

// A closing step: recap what was covered and invite the user to close the panel.
// It has no `check`, so it's a read-only notice the user finishes with the button.
const recapStep = (text) => ({
  id: 'recap',
  prompt: text,
  note: 'Tutorial complete — close this window (✕) whenever you’re ready.',
  highlight: null,
  pause: false,
  setup: (a) => a.setConfig({ trim: 'none', inducedClimb: false }), // clear induced demo conditions
})

// LESSONS -------------------------------------------------------------------

const startup = {
  id: 'startup',
  title: 'Startup & basic modes',
  blurb: 'Power up, sync the altimeter, engage, then fly a heading and altitudes.',
  init: (a) => reset(a, { ...NAV_NONE, groundSpeed: 120, curAlt: 3000 }), // stays off — the user powers on
  steps: [
    {
      id: 'power-on',
      prompt: 'Flip the PWR switch up to power the autopilot on.',
      highlight: 'pwr',
      check: (s) => s.power !== 'off',
    },
    bootStep,
    ...altSyncSteps('The autopilot reads its own pressure altitude, which comes up ~200 ft off the PFD. Sync it on the startup check.'),
    {
      id: 'engage',
      prompt: 'Press the knob to engage the autopilot.',
      highlight: 'knob',
      check: (s) => s.apEngaged,
    },
    {
      id: 'set-heading',
      prompt: 'Twist the knob to set a new heading (turn it at least a few clicks).',
      note: 'Engaged in TRK, the knob selects the track to fly.',
      highlight: 'knob',
      check: (s) => s.lateralMode === 'TRK' && Math.abs(angleDiff(200, s.selTrack)) >= 15,
    },
    {
      id: 'watch-turn',
      prompt: 'Watch the autopilot bank and roll out on the new heading.',
      highlight: null,
      pause: false,
      allowPreSatisfied: true,
      check: (s) => Math.abs(angleDiff(s.curTrack, s.selTrack)) < 3,
    },
    {
      id: 'alt-hold',
      prompt: 'Press ALT, then press the knob WITHOUT turning it to hold the current altitude.',
      note: 'ALT then KNOB (no turn) captures the current altitude into ALT HOLD (§5.4.2).',
      highlight: altThenKnob,
      check: (s) => s.verticalMode === 'ALTHOLD',
    },
    {
      id: 'sel-alt',
      prompt: 'Now climb to 3,500 ft (just 500 above): press ALT, twist to 3500, press the knob to move to SEL VS, set about 700 fpm up, then press to confirm.',
      note: 'A small altitude change with a healthy rate keeps the demo quick.',
      highlight: altThenKnob,
      check: (s) => s.verticalMode === 'SEL',
    },
    {
      id: 'watch-capture',
      prompt: 'Watch the autopilot climb to 3,500 ft and capture it (back to ALT HOLD).',
      highlight: null,
      pause: false,
      check: (s) => s.verticalMode === 'ALTHOLD',
    },
    {
      id: 'trim',
      prompt:
        'A note on trim: climbing or slowing down leaves the autopilot holding nose-up pressure. When it does, a flashing UP (or DN) trim arrow appears on the display — you’d add trim until it clears.',
      note: 'This trainer has no trim control, so this is just to show the annunciation (induced here for illustration).',
      highlight: null,
      pause: false,
      setup: (a) => a.setConfig({ trim: 'up' }),
    },
    recapStep(
      'That’s the core flow: power on, ALT SYNC, engage, set a heading in TRK, then ALT HOLD to hold and SEL to climb/descend to a new altitude. Keep the airplane in trim as you go.'
    ),
  ],
}

const coupledApproach = {
  id: 'approach',
  title: 'Coupled GPS approach (430W)',
  blurb: 'Fly the RNAV (GPS) RWY 10 fully coupled, then go missed at the MAP.',
  init: (a) => {
    reset(a, { ...NAV_NONE, groundSpeed: 150, curAlt: 3000 })
    a.setConfig({ power: 'on' })
  },
  steps: [
    bootStep,
    {
      id: 'src-430w',
      prompt: 'Select GPS as the nav source.',
      note: 'A WAAS IFR GPS gives GPSS roll steering and the coupled LPV glidepath.',
      highlight: 'navSource',
      check: (s) => s.gpsData === 'ifr' && s.skyview === 'off',
    },
    ...altSyncSteps('Pre-flight altimeter check — dial the autopilot offset to zero.'),
    {
      id: 'start-iaf',
      prompt: 'Load the approach: pick an initial fix to begin — try WUDAT (the south T-bar arm).',
      note: 'Loading an IAF arms the LPV approach automatically.',
      highlight: 'iaf',
      check: (s) => s.scenarioActive === true,
    },
    {
      id: 'engage',
      prompt: 'Press the knob to engage the autopilot.',
      highlight: 'knob',
      check: (s) => s.apEngaged,
    },
    {
      id: 'gpss',
      prompt: 'Press MODE to cycle from TRK to GPSS so the GPS flies the plan.',
      highlight: 'mode',
      check: (s) => s.lateralMode === 'GPSS',
    },
    {
      id: 'resync',
      prompt: 'Arming GPSS re-introduced a baro mismatch — ALT SYNC again as a pre-procedure check. Press ALT twice, dial the offset to ~0, press to confirm.',
      note: 'Real habit: verify the altimeter before every approach.',
      highlight: altSyncFocus,
      check: (s) => synced(s) && s.screen === 'NORMAL',
    },
    {
      id: 'platform',
      prompt: 'Descend to the 2300 ft platform: press ALT, set 2300, add a descent rate (~700 fpm down), and confirm.',
      highlight: altThenKnob,
      check: (s) => s.verticalMode === 'SEL' && s.selAlt <= 2400,
    },
    {
      id: 'level-platform',
      prompt: 'Let it descend and level at 2300 while GPSS flies you toward ZIMBO.',
      highlight: null,
      pause: false,
      check: (s) => s.verticalMode === 'ALTHOLD' && s.curAlt < 2500,
    },
    {
      id: 'couple',
      prompt: 'At ZIMBO the LPV glideslope couples automatically — watch it start down.',
      note: 'GS ARM → GS CPLD as the glidepath descends to meet you at the FAF.',
      highlight: null,
      pause: false,
      check: (s) => s.verticalMode === 'GS_CPLD',
    },
    {
      id: 'to-mins',
      prompt: 'Ride the glidepath down. The autopilot is not authorized below 700 ft AGL.',
      highlight: null,
      pause: false,
      check: (s) => s.agl != null && s.agl <= 700,
    },
    {
      id: 'go-missed',
      prompt: 'Going missed: press ALT to break off the glideslope and climb (the autopilot stays in GPSS).',
      note: 'A momentary ALT press in GS CPLD starts a 500 fpm missed-approach climb, staying in GPSS (§5.4.6). The display shows SVS (the climb rate) — a missed approach has no target altitude.',
      highlight: 'alt',
      check: (s) => s.verticalMode === 'SVS' && s.selVS > 0,
    },
    {
      id: 'climb-out',
      prompt: 'Watch the missed-approach climb away from the runway.',
      highlight: null,
      pause: false,
      check: (s) => s.agl != null && s.agl > 1000,
    },
    recapStep(
      'You flew a fully coupled approach: 430W + GPSS flies the lateral plan, you stepped down to the 2,300 ft platform, the LPV glidepath coupled at the FAF, and an ALT press at the MAP started the missed-approach climb.'
    ),
  ],
}

const skyview = {
  id: 'skyview',
  title: 'SkyView & nav variations',
  blurb: 'SkyView mode per the install manual: bugs, MODE in/out, ALT HOLD, a course & a crosswind.',
  init: (a) => {
    reset(a, { ...NAV_NONE, groundSpeed: 150, curAlt: 3000, svAltBug: 3300, svVsBug: 0 })
    a.setConfig({ power: 'on' })
  },
  steps: [
    bootStep,
    {
      id: 'src-skyview',
      prompt: 'Select SkyView as the nav source.',
      note: 'With a SkyView connected, the MODE button toggles SkyView mode and all commands come from the SkyView — not the autopilot (Install Manual §10).',
      highlight: 'navSource',
      check: (s) => s.skyview === 'on',
    },
    ...altSyncSteps(
      'BE SURE TO SYNC THE ALTIMETER to the SkyView before using SkyView mode — the SkyView cannot auto-sync it (unlike Aspen/G5). The manual stresses this.'
    ),
    {
      id: 'hdg-bug',
      prompt: 'Set the heading bug: turn the SkyView HDG/TRK knob (or drag the HSI).',
      note: 'The CDI source decides what the autopilot follows laterally — more on that after engaging.',
      highlight: 'svHdgKnob',
      check: (s) => Math.abs(angleDiff(160, s.svHeadingBug)) >= 15,
    },
    {
      id: 'alt-bug',
      prompt: 'Set the altitude bug a few hundred feet above you (turn the SkyView ALT knob, or drag the alt tape).',
      highlight: 'svAltKnob',
      check: (s) => s.svAltBug >= 3200,
    },
    {
      id: 'vs-bug',
      prompt: 'Now set a vertical-speed bug too: drag the VS tape to about +500 fpm.',
      note: 'For vertical control the SkyView needs BOTH an altitude bug AND a VS bug — pick a VS appropriate for the target. (With no altitude bug set, the autopilot just follows the VS bug.)',
      highlight: 'vsBug',
      check: (s) => Math.abs(s.svVsBug) >= 300,
    },
    {
      id: 'enter-mode',
      prompt: 'Press MODE on the autopilot to enter SkyView mode.',
      note: 'MODE enters SkyView mode whether the AP is off (powered, not engaged) or already engaged. On entry the Vizion grabs the SkyView’s current heading, altitude, and VS bugs.',
      highlight: 'mode',
      check: (s) => s.lateralMode === 'SKYVIEW',
    },
    {
      id: 'engage',
      prompt: 'Press the knob to engage the autopilot and fly the bugs.',
      highlight: 'knob',
      check: (s) => s.apEngaged && s.lateralMode === 'SKYVIEW',
    },
    {
      id: 'althold',
      prompt: 'Watch it climb to the altitude bug and level off — the display then shows ALT HOLD.',
      note: 'This takes a few seconds as it climbs to the bug.',
      highlight: null,
      pause: false,
      check: (s) => s.verticalMode === 'ALTHOLD',
    },
    {
      id: 'cdi-gps',
      prompt: 'Set the PFD CDI source to GPS so the autopilot flies the lateral flight plan.',
      note: 'CDI source sets the lateral behavior: SKYVIEW or an external GPS (e.g. GNS430) follows the flight plan; no selection — or LOC/VOR/ILS — follows the heading bug instead. Through the SkyView you get the lateral course only — there is no coupled glideslope.',
      highlight: 'cdiSource',
      check: (s) => s.skyviewCdi === 'flightplan',
    },
    {
      id: 'ubaya',
      prompt: 'Start at UBAYA·teardrop (NE) — the GPS flies the hold-in-lieu procedure turn to reverse onto the final.',
      highlight: 'iaf',
      check: (s) => s.scenarioActive && s.hilptEntry === 'TEARDROP',
    },
    {
      id: 'stepdown',
      prompt: 'No glideslope here — step down by lowering the SkyView ALT bug to about 2,300 ft; the autopilot descends to the bug, then holds (ALT HOLD).',
      highlight: 'svAltKnob',
      pause: false,
      check: (s) => s.svAltBug <= 2400,
    },
    {
      id: 'wind',
      prompt: 'Add a crosswind: drag the Wind speed slider up above ~10 kt.',
      highlight: 'windSlider',
      check: (s) => s.windSpd > 10,
    },
    {
      id: 'crab',
      prompt: 'Watch the autopilot crab into the wind — the magenta ground-track diamond offsets from the nose while the course stays centered.',
      highlight: null,
      pause: false,
      check: (s) => Math.abs(angleDiff(s.curGT, s.curTrack)) >= 5,
    },
    {
      id: 'exit-mode',
      prompt: 'Press MODE again to exit SkyView mode — it reverts to TRK, syncing to your current track and vertical speed.',
      highlight: 'mode',
      check: (s) => s.lateralMode !== 'SKYVIEW',
    },
    recapStep(
      'SkyView mode (Install Manual §10): MODE enters/exits it; sync the altimeter first; the CDI source picks heading-bug vs flight-plan tracking; set an ALT bug AND a VS bug for vertical (ALT HOLD on capture); there is no coupled glideslope; and exiting with MODE syncs your current track and VS.'
    ),
  ],
}

const emergencies = {
  id: 'emergencies',
  title: 'Emergencies & safety',
  blurb: 'Emergency LEVEL, CWS, AEP, a sensor failure, and the altimeter-sync gotcha.',
  init: (a) => {
    reset(a, { ...NAV_430W, groundSpeed: 120, curAlt: 3000 })
    a.setConfig({ power: 'on' })
  },
  steps: [
    bootStep,
    {
      id: 'induce-bank',
      prompt: "You're disengaged in a developing bank — the airplane is rolling off into a descending turn, picking up speed.",
      highlight: null,
      pause: false,
      setup: (a) => a.setConfig({ inducedBank: 25 }),
      allowPreSatisfied: true,
      check: (s) => Math.abs(s.bankAngle) > 15,
    },
    {
      id: 'level',
      prompt: 'It keeps banking, turning, and descending. Press LEVEL — the autopilot engages and rolls wings-level, zero VS.',
      highlight: 'level',
      pause: false, // keep the sim live so the upset develops until LEVEL recovers it
      check: (s) => s.emergencyLevel === true,
    },
    {
      id: 'level-revert',
      prompt: 'Emergency level recovers the airplane, then reverts to TRK after about 15 seconds.',
      highlight: null,
      pause: false,
      setup: (a) => a.setConfig({ inducedBank: 0 }),
      check: (s) => !s.emergencyLevel && s.lateralMode === 'TRK' && s.apEngaged,
    },
    {
      id: 'min-as',
      prompt: 'Airspeed protection (engaged): a held nose-up bleeds the speed. At the minimum, MIN AS flashes and the autopilot lowers the nose to hold the minimum until the speed recovers.',
      note: 'This works while the autopilot is engaged — separate from AEP, which is the bank backstop while disengaged.',
      highlight: null,
      pause: false,
      setup: (a) => a.setConfig({ inducedClimb: true, groundSpeed: 120 }),
      check: (s) => s.warning === 'MIN_AS',
    },
    {
      id: 'cws',
      prompt: 'Hold the CWS button to hand-fly (CWS AP), then release to resume on the new attitude.',
      note: 'A quick TAP of CWS instead disconnects the autopilot.',
      highlight: 'cws',
      pause: false,
      setup: (a) => a.setConfig({ inducedClimb: false, warning: null }), // end the airspeed demo
      check: (s) => s.cwsHeld === true,
    },
    {
      id: 'disengage',
      prompt: 'Disengage the autopilot: press and HOLD the knob.',
      highlight: 'knob',
      check: (s) => !s.apEngaged,
    },
    {
      id: 'aep-bank',
      prompt: 'AEP stays armed (STBY) while the autopilot is off. Watch a bank develop — at 40° AEP trips to ACTIVE and nudges the bank back inside the limit (it holds you off the limit; it does not roll fully level).',
      note: 'Automatic Emergency Protection: a hands-off bank backstop when the AP is disengaged.',
      highlight: null,
      pause: false,
      setup: (a) => a.setConfig({ aep: 'stby', inducedBank: 50, inducedClimb: false }),
      check: (s) => s.aep === 'active',
    },
    {
      id: 'aep-disable',
      prompt: 'AEP can be turned off: while disengaged, press MODE to toggle it OFF.',
      note: 'Only disable it for planned maneuvers — steep turns, stalls — where the protection would get in the way. Re-arm it (MODE again) afterward.',
      highlight: 'mode',
      setup: (a) => a.setConfig({ aep: 'stby', inducedBank: 0, inducedClimb: false }),
      check: (s) => s.aep === 'off',
    },
    {
      id: 'sensor',
      prompt: 'Trigger a sensor error (Induce conditions → Sensor). The autopilot disconnects and latches a warning.',
      highlight: 'sensorBtn',
      setup: (a) => a.setConfig({ inducedBank: 0 }),
      check: (s) => s.warning === 'SENSOR' && !s.apEngaged,
    },
    {
      id: 'power-cycle',
      prompt: 'The sensor latch only clears on a power cycle — flip PWR off, then on.',
      highlight: 'pwr',
      check: (s) => s.warning === null && s.power !== 'off',
    },
    bootStep,
    {
      id: 'gotcha',
      prompt: 'After the cycle the baro mismatch is back. ALT SYNC again before flying: press ALT twice, dial to ~0.',
      note: 'The altimeter offset returns on every power-up (unless an Aspen/G5 auto-syncs it).',
      highlight: altSyncFocus,
      check: synced,
    },
    recapStep(
      'Your safety net: LEVEL for an upset; CWS to hand-fly and resume; the MIN/MAX airspeed protection that holds the limits while engaged; and AEP, the hands-off bank backstop when disengaged (which you can turn off for planned maneuvers). And a sensor latch clears only on a power cycle, after which you ALT SYNC again.'
    ),
  ],
}

export const LESSONS = [startup, coupledApproach, skyview, emergencies]

export function lessonById(id) {
  return LESSONS.find((l) => l.id === id) || null
}

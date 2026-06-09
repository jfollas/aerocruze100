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
    prompt: "Twist the knob to set the autopilot's altitude to match the airplane's altimeter (your PFD), then press the knob to confirm.",
    highlight: 'knob',
    check: (s) => synced(s) && s.screen === 'NORMAL',
  },
]

// An opening step: states the lesson's goals and notes the window can be moved.
// No `check`, so it's a read-only notice the user advances with Next. Default
// pause (true) freezes the clock so a powered-on lesson doesn't boot while it's read.
const openerStep = (goals) => ({
  id: 'intro',
  prompt: goals,
  note: 'Tip: drag this window by its title bar to move it anywhere on screen — keep it clear of the controls or the display you want to watch.',
  highlight: null,
})

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
    openerStep(
      'Goals: power the autopilot up, sync its altimeter to your PFD, engage it, then fly a selected heading in TRK and use ALT HOLD and altitude-select (SEL) to hold and change altitude — plus how trim is annunciated.'
    ),
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
      accel: 4,
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
      // The narration is broken into one-task-at-a-time cues (see tutorialAudio.js),
      // each advancing when the user completes that sub-action:
      //   0 press ALT · 1 dial to 3500 · 2 press to VS · 3 set the rate · 4 confirm
      cues: [
        { until: (s) => s.screen === 'SEL_ALT' },
        { until: (s) => s.selAlt >= 3500 },
        { until: (s) => s.cursor === 'vs' },
        { until: (s) => s.selVS >= 600 },
        {}, // "press to confirm" — the step's own check advances to the next step
      ],
      check: (s) => s.verticalMode === 'SEL',
    },
    {
      id: 'watch-capture',
      prompt: 'Watch the autopilot climb to 3,500 ft and capture it (back to ALT HOLD).',
      highlight: null,
      pause: false,
      accel: true,
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
    openerStep(
      'Goals: set up and fly a fully coupled RNAV (GPS) LPV approach on the GPS (430W) — arm the approach, fly it in GPSS, step down to the platform altitude, let the LPV glideslope couple at the final approach fix, then start a missed approach.'
    ),
    bootStep,
    {
      id: 'src-430w',
      prompt: 'Select GPS as the nav source.',
      note: 'A WAAS IFR GPS gives GPSS roll steering and the coupled LPV glidepath.',
      highlight: 'navSource',
      check: (s) => s.gpsData === 'ifr' && s.skyview === 'off',
    },
    ...altSyncSteps("Pre-flight altimeter check — set the autopilot's altitude to match the airplane's."),
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
      prompt: "You'll be flying altitude restrictions on this approach, so make sure the autopilot's altimeter matches the airplane's. ALT SYNC now: press ALT twice, set the autopilot's altitude to match the airplane's altimeter, press to confirm.",
      note: 'Real habit: verify the altimeter before every approach.',
      highlight: altSyncFocus,
      check: (s) => synced(s) && s.screen === 'NORMAL',
    },
    {
      id: 'platform',
      prompt: 'Descend to the 2300 ft platform: press ALT, set 2300, add a descent rate (~700 fpm down), and confirm.',
      highlight: altThenKnob,
      // one-task-at-a-time narration (see tutorialAudio.js):
      //   0 press ALT · 1 dial to 2300 · 2 press to VS · 3 set the descent · 4 confirm
      cues: [
        { until: (s) => s.screen === 'SEL_ALT' },
        { until: (s) => s.selAlt <= 2400 },
        { until: (s) => s.cursor === 'vs' },
        { until: (s) => s.selVS <= -600 },
        {}, // "press to confirm" — the step's own check advances to the next step
      ],
      check: (s) => s.verticalMode === 'SEL' && s.selAlt <= 2400,
    },
    {
      id: 'level-platform',
      prompt: 'Let it descend and level at 2300 while GPSS flies you toward ZIMBO.',
      highlight: null,
      pause: false,
      accel: true,
      check: (s) => s.verticalMode === 'ALTHOLD' && s.curAlt < 2500,
    },
    {
      id: 'couple',
      prompt: 'At ZIMBO the LPV glideslope couples automatically — watch it start down.',
      note: 'GS ARM → GS CPLD as the glidepath descends to meet you at the FAF.',
      highlight: null,
      pause: false,
      accel: true,
      check: (s) => s.verticalMode === 'GS_CPLD',
    },
    {
      id: 'to-mins',
      prompt: 'Ride the glidepath down. The autopilot is not authorized below 700 ft AGL.',
      highlight: null,
      pause: false,
      accel: true,
      check: (s) => s.agl != null && s.agl <= 700,
    },
    {
      id: 'go-missed',
      prompt: 'Going missed: while still coupled (GS CPLD), momentarily press ALT to break off the glideslope and climb (the autopilot stays in GPSS).',
      note: 'This only works while GS CPLD — the ALT-press missed-approach climb (500 fpm, staying in GPSS, §5.4.6) can only be initiated while coupled to the glideslope. If you let it drop below 700 ft AGL or disconnect first, you fly the missed by hand. The display shows SVS (the climb rate) — a missed approach has no target altitude.',
      highlight: 'alt',
      check: (s) => s.verticalMode === 'SVS' && s.selVS > 0,
    },
    {
      id: 'climb-out',
      prompt:
        'Watch the missed-approach climb away from the runway. Important: this is a vertical-speed (SVS) climb with no target altitude — the autopilot will NOT level off at the missed-approach altitude on its own. You must stop the climb yourself and manage power and trim as required.',
      note: 'A missed-approach climb has no altitude capture — the pilot levels it off (§5.4.6).',
      highlight: null,
      pause: false,
      accel: true,
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
    // Bug starts at the current altitude and no VS, so the bug-setting steps need
    // a real action (not pre-satisfied) and the later ALT HOLD demo gets a real climb.
    reset(a, { ...NAV_NONE, groundSpeed: 150, curAlt: 3000, svAltBug: 3000, svVsBug: 0 })
    a.setConfig({ power: 'on' })
  },
  steps: [
    openerStep(
      'Goals: operate the autopilot in Dynon SkyView mode — set the heading, altitude and VS bugs, enter and exit with MODE, pick the CDI source, fly a hold-in-lieu course reversal and an LNAV-style stepdown (no coupled glideslope), and watch it crab in a crosswind.'
    ),
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
      prompt: 'Set the altitude bug a few hundred feet above you — to about 3,300 ft. Turn the SkyView ALT knob, or drag the ALT bug up.',
      note: 'Drag the bug itself (the marker beside the altitude tape), not the tape — dragging the tape moves the airplane’s altitude instead.',
      highlight: 'svAltKnob',
      check: (s) => s.svAltBug >= 3300,
    },
    {
      // No VS dial on the SkyView panel in this trainer, so set the VS bug for
      // the user rather than asking them to drag it.
      id: 'vs-bug',
      prompt: "Vertical control also needs a vertical-speed bug. There's no VS dial on the SkyView panel here, so we've set a +500 fpm VS bug for you.",
      note: 'On a real SkyView you set the VS bug on the Dynon. Vertical needs BOTH an altitude bug AND a VS bug — with no altitude bug set, the autopilot just follows the VS bug.',
      highlight: null,
      setup: (a) => a.setConfig({ svVsBug: 500 }),
    },
    {
      id: 'enter-mode',
      prompt: 'Press MODE on the autopilot to enter SkyView mode — it engages right away and starts flying the bugs. No separate knob press is needed to activate it.',
      note: 'MODE enters SkyView mode from the AP-OFF screen (powered, not engaged) or while already engaged; on entry the Vizion grabs the SkyView’s current heading, altitude and VS bugs (Install Manual §10.2).',
      highlight: 'mode',
      check: (s) => s.apEngaged && s.lateralMode === 'SKYVIEW',
    },
    {
      id: 'althold',
      prompt: 'Watch it climb to the altitude bug and level off — the display then shows ALT HOLD.',
      note: 'This takes a few seconds as it climbs to the bug.',
      highlight: null,
      pause: false,
      accel: true,
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
      id: 'watch-entry',
      prompt: 'Watch the GPS fly the hold-in-lieu procedure turn — outbound, then a turn to reverse course and roll out established on the inbound final approach course.',
      highlight: null,
      pause: false,
      accel: true,
      check: (s) => Math.abs(angleDiff(s.gpsDtk, 96)) < 12 && Math.abs(s.cdiDev) < 0.7,
    },
    {
      id: 'stepdown',
      prompt: 'No glideslope through the SkyView — so step the altitude down yourself: lower the SkyView ALT bug to about 2,300 ft.',
      note: 'You fly the vertical with the bugs here; the GPS only supplies the lateral course.',
      highlight: 'svAltKnob',
      check: (s) => s.svAltBug <= 2400,
    },
    {
      id: 'watch-descent',
      prompt: 'Watch it descend to the bug and level at 2,300 ft — the display shows ALT HOLD.',
      highlight: null,
      pause: false,
      accel: true,
      check: (s) => s.verticalMode === 'ALTHOLD' && s.curAlt < 2500,
    },
    {
      // The crab is a steady-state result that appears within a tick of the wind
      // being set, so there's nothing to "wait out" — make it a read-then-Next
      // notice (clock running so the crab develops and stays visible) rather than
      // auto-advancing the instant the diamond offsets.
      id: 'crab',
      prompt:
        "We've added a crosswind. Watch the autopilot crab into it — the magenta ground-track diamond offsets from the nose while the course stays centred. When you're done watching, press Next.",
      highlight: null,
      pause: false,
      setup: (a) => a.setConfig({ windDir: 186, windSpd: 25 }), // a crosswind on the ~096 inbound, set for the user
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
    openerStep(
      'Goals: use the safety features — emergency LEVEL recovery, control-wheel steering (CWS), the engaged minimum-airspeed protection and the disengaged AEP bank backstop, a sensor failure and its power-cycle reset, and the altimeter-sync gotcha.'
    ),
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
      prompt: 'It keeps banking, turning, and descending. Press the LEVEL button.',
      highlight: 'level',
      pause: false, // keep the sim live so the upset develops until LEVEL recovers it
      check: (s) => s.emergencyLevel === true,
    },
    {
      // After the press, the next clip explains the recovery while you watch it
      // happen. Observe step (highlight null) -> it waits for the narration to
      // finish before moving on.
      id: 'level-recover',
      prompt: 'The autopilot engages, rolls the wings level, and stops the descent — zero vertical speed.',
      highlight: null,
      pause: false,
      allowPreSatisfied: true,
      check: (s) => s.emergencyLevel === true,
    },
    {
      id: 'level-revert',
      prompt: 'Emergency level recovers the airplane, then reverts to TRK after about 15 seconds.',
      highlight: null,
      pause: false,
      accel: 4,
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
      prompt:
        "Press and HOLD the CWS button to hand-fly (CWS AP). On the real airplane you'd steer with the yoke; there's no yoke here, so I'll turn the airplane toward a new heading for you while you hold it. Release when you like the heading — the autopilot resumes and holds it (TRK). Notice the new track.",
      note: 'A quick TAP of CWS instead disconnects the autopilot.',
      highlight: 'cws',
      pause: false,
      setup: (a) => a.setConfig({ inducedClimb: false, warning: null, cwsStartTrack: null }), // end the airspeed demo
      // complete after release, once the hand-flown turn has changed the heading AND
      // the autopilot has rolled back to wings-level (so the next, clock-paused step
      // doesn't freeze the display mid-bank)
      check: (s) =>
        !s.cwsHeld &&
        s.cwsStartTrack != null &&
        Math.abs(angleDiff(s.curTrack, s.cwsStartTrack)) > 8 &&
        Math.abs(s.bankAngle) < 3,
    },
    {
      id: 'disengage',
      prompt: 'Disengage the autopilot two ways: press and HOLD the knob, or give the CWS button a quick tap (press and release). Either one disconnects it.',
      highlight: 'knob',
      check: (s) => !s.apEngaged,
    },
    {
      // Read-then-Next so the user can watch the protection cycle: the bank builds
      // to ~45°, AEP trips ACTIVE and nudges it back to ~35°, then catches it again
      // and again. The clock runs (pause:false), and advancing levels the airplane
      // (the next step's setup snaps the bank back to wings-level).
      id: 'aep-bank',
      prompt:
        "AEP stays armed (STBY) while the autopilot is off. Watch the bank build up to about 45°, where AEP trips to ACTIVE and nudges it back to a safe ~35° — then it catches the bank again and again as the over-bank continues. It holds you off the limit; it does NOT roll fully level. Watch a couple of cycles, then press Next.",
      note: 'Automatic Emergency Protection: a hands-off bank backstop when the AP is disengaged.',
      highlight: null,
      pause: false,
      setup: (a) => a.setConfig({ aep: 'stby', inducedBank: 50, inducedClimb: false }),
    },
    {
      id: 'aep-disable',
      prompt: 'AEP can be turned off: while disengaged, press MODE to toggle it OFF.',
      note: 'Only disable it for planned maneuvers — steep turns, stalls — where the protection would get in the way. Re-arm it (MODE again) afterward.',
      highlight: 'mode',
      // end the AEP demo and return to fully level — wings AND pitch — as this step starts
      setup: (a) =>
        a.setConfig({ aep: 'stby', inducedBank: 0, bankAngle: 0, pitch: 0, curVS: 0, inducedClimb: false }),
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
      prompt: "After a power cycle, confirm the autopilot's altimeter is still in sync before you fly. If it's off, ALT SYNC again: press ALT twice and set it to match the airplane's altimeter.",
      note: 'Make checking the altimeter part of your power-up routine — re-sync it if it has drifted.',
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

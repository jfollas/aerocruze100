import { useState, useEffect, useRef, useCallback } from 'react'
import { lessonById } from '../sim/tutorials.js'
import { TUTORIAL_AUDIO } from '../sim/tutorialAudio.js'

const ACCEL_DEFAULT = 8 // clock multiplier for steps tagged `accel: true`
const AUDIO_BASE = import.meta.env.BASE_URL + 'tutorial-audio/'
const MUTE_KEY = 'aerocruze.tutorialMuted'

// Owns the walkthrough UI state and the step engine. Watches the reducer `state`
// and auto-advances when the current step's `check` predicate is satisfied; runs
// each lesson's `init` and each step's `setup` once; plays the step's spoken
// narration; and exposes a `paused` flag the App uses to freeze the sim clock.
export function useTutorial(state, actions) {
  const [lessonId, setLessonId] = useState(null)
  const [stepIndex, setStepIndex] = useState(0)
  const [flash, setFlash] = useState(false)
  const [cueIndex, setCueIndex] = useState(0) // sub-cue within a multi-task step's `cues`
  const [muted, setMuted] = useState(() => {
    try {
      return localStorage.getItem(MUTE_KEY) === '1'
    } catch {
      return false
    }
  })

  const lesson = lessonId ? lessonById(lessonId) : null
  const steps = lesson ? lesson.steps : []
  const step = lesson ? steps[stepIndex] : null
  const active = !!lesson

  const initedRef = useRef(null) // lessonId whose init() has run
  const setupKeyRef = useRef('') // "lessonId#stepIndex" whose setup() has run
  const seenFalseRef = useRef(false) // entry-guard: has check been observed false?
  const advancingRef = useRef('') // step key currently flashing -> advancing (one-shot)
  const flashTimer = useRef(null)
  const endedCleanup = useRef(null) // removes a pending narration 'ended' listener
  const audioRef = useRef(null)
  if (audioRef.current === null && typeof Audio !== 'undefined') audioRef.current = new Audio()

  const clearPending = () => {
    clearTimeout(flashTimer.current)
    if (endedCleanup.current) {
      endedCleanup.current()
      endedCleanup.current = null
    }
  }

  const advance = useCallback(() => {
    clearTimeout(flashTimer.current)
    if (endedCleanup.current) {
      endedCleanup.current()
      endedCleanup.current = null
    }
    advancingRef.current = ''
    setStepIndex((i) => {
      const last = (lessonById(lessonId)?.steps.length || 0) - 1
      if (i >= last) {
        setLessonId(null) // finished the lesson
        return 0
      }
      return i + 1
    })
  }, [lessonId])

  // run lesson.init() once when a lesson (re)starts
  useEffect(() => {
    if (lessonId && initedRef.current !== lessonId) {
      initedRef.current = lessonId
      lessonById(lessonId)?.init?.(actions)
    } else if (!lessonId) {
      initedRef.current = null
    }
  }, [lessonId, actions])

  // run step.setup() once on entering a step, and (re)arm the entry-guard
  useEffect(() => {
    if (!lessonId || !step) return
    const key = lessonId + '#' + stepIndex
    if (setupKeyRef.current === key) return
    setupKeyRef.current = key
    step.setup?.(actions)
    seenFalseRef.current = step.check ? !step.check(state) : false
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonId, stepIndex])

  // reset the sub-cue pointer when the step changes
  useEffect(() => {
    setCueIndex(0)
  }, [lessonId, stepIndex])

  // A multi-task step (one with `cues`) gives one instruction at a time and steps
  // its narration to the next cue as the user performs each sub-action. The step's
  // own `check` still governs the final advance to the next step.
  useEffect(() => {
    if (!active || !step || !step.cues) return
    const cue = step.cues[cueIndex]
    if (cueIndex < step.cues.length - 1 && cue?.until?.(state)) setCueIndex((i) => i + 1)
  }, [state, active, step, cueIndex, lessonId, stepIndex])

  // spoken narration: (re)play the current clip when the step (or its cue) changes
  useEffect(() => {
    const a = audioRef.current
    if (!a) return
    a.pause()
    if (!active || muted || !lessonId || !step) return
    const key = step.cues
      ? `${lessonId}/${step.id}#${Math.min(cueIndex, step.cues.length - 1)}`
      : `${lessonId}/${step.id}`
    const file = TUTORIAL_AUDIO[key]
    if (!file) return
    a.src = AUDIO_BASE + file
    a.currentTime = 0
    a.play().catch(() => {}) // autoplay may be blocked until a user gesture
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, lessonId, stepIndex, muted, cueIndex])

  // a step's highlight may be a function of state, so the focus can move within a
  // compound step (e.g. ALT to open the screen, then the knob to dial/confirm)
  const rawHighlight = step ? (typeof step.highlight === 'function' ? step.highlight(state) : step.highlight) : null

  // auto-advance when the step's predicate is satisfied (after a brief ✓ flash).
  // advancingRef makes this one-shot per step (guards the StrictMode double-invoke).
  useEffect(() => {
    if (!active || !step || flash || !step.check) return
    const key = lessonId + '#' + stepIndex
    if (advancingRef.current === key) return
    if (!step.check(state)) {
      seenFalseRef.current = true
      return
    }
    if (!seenFalseRef.current && !step.allowPreSatisfied) return // require a real transition

    advancingRef.current = key
    setFlash(true)
    const go = () => {
      if (endedCleanup.current) {
        endedCleanup.current()
        endedCleanup.current = null
      }
      setFlash(false)
      advance()
    }
    // On an observe ("watch") step the user isn't acting — let the narration finish
    // before moving on, so the voice isn't cut off mid-sentence. Action steps (which
    // point at a control) advance right away once the user has done the thing.
    const a = audioRef.current
    const observe = rawHighlight == null
    if (observe && a && !muted && !a.paused) {
      const onEnded = () => {
        clearTimeout(flashTimer.current)
        endedCleanup.current = null
        flashTimer.current = setTimeout(go, 250)
      }
      a.addEventListener('ended', onEnded, { once: true })
      endedCleanup.current = () => a.removeEventListener('ended', onEnded)
      // safety cap (also covers mute/pause suppressing 'ended'): the clip's remaining time
      const remaining = isFinite(a.duration) && a.duration > 0 ? (a.duration - a.currentTime) * 1000 : 8000
      flashTimer.current = setTimeout(go, Math.max(650, remaining + 400))
    } else {
      flashTimer.current = setTimeout(go, 650)
    }
  }, [state, active, step, flash, advance, lessonId, stepIndex, rawHighlight, muted])

  // tidy timers / narration on unmount
  useEffect(
    () => () => {
      clearTimeout(flashTimer.current)
      if (endedCleanup.current) endedCleanup.current()
      audioRef.current?.pause()
    },
    []
  )

  const toggleMuted = useCallback(() => {
    setMuted((m) => {
      const next = !m
      try {
        localStorage.setItem(MUTE_KEY, next ? '1' : '0')
      } catch {
        /* ignore */
      }
      return next
    })
  }, [])

  const restart = (cb) => {
    clearPending()
    audioRef.current?.pause()
    initedRef.current = null
    setupKeyRef.current = ''
    advancingRef.current = ''
    setFlash(false)
    cb()
  }

  // Time acceleration: clock-running "fly the airplane" waits (a leg, a hold, a
  // climb) tag themselves with `accel` so the tutorial fast-forwards through the
  // dull bits. We hold it at 1× during the ✓ flash so we don't over-fly the fix.
  const clockMultiplier =
    active && step && step.pause === false && !flash && step.accel
      ? step.accel === true
        ? ACCEL_DEFAULT
        : step.accel
      : 1

  return {
    active,
    lesson,
    step,
    stepIndex,
    stepCount: steps.length,
    flash,
    paused: !!(active && step && step.pause !== false),
    clockMultiplier,
    muted,
    toggleMuted,
    highlight: active && !flash && step ? rawHighlight || null : null,
    start: (id) => restart(() => { setLessonId(id); setStepIndex(0) }),
    exit: () => restart(() => { setLessonId(null); setStepIndex(0) }),
    next: () => advance(),
    prev: () => { clearPending(); setFlash(false); setStepIndex((i) => Math.max(0, i - 1)) },
    skip: () => { setFlash(false); advance() },
  }
}

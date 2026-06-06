import { useState, useEffect, useRef, useCallback } from 'react'
import { lessonById } from '../sim/tutorials.js'

// Owns the walkthrough UI state and the step engine. Watches the reducer `state`
// and auto-advances when the current step's `check` predicate is satisfied; runs
// each lesson's `init` and each step's `setup` once; and exposes a `paused` flag
// the App uses to freeze the sim clock during discrete-action steps.
export function useTutorial(state, actions) {
  const [lessonId, setLessonId] = useState(null)
  const [stepIndex, setStepIndex] = useState(0)
  const [flash, setFlash] = useState(false)

  const lesson = lessonId ? lessonById(lessonId) : null
  const steps = lesson ? lesson.steps : []
  const step = lesson ? steps[stepIndex] : null
  const active = !!lesson

  const initedRef = useRef(null) // lessonId whose init() has run
  const setupKeyRef = useRef('') // "lessonId#stepIndex" whose setup() has run
  const seenFalseRef = useRef(false) // entry-guard: has check been observed false?
  const advancingRef = useRef('') // step key currently flashing -> advancing (one-shot)
  const flashTimer = useRef(null)

  const advance = useCallback(() => {
    clearTimeout(flashTimer.current)
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
    flashTimer.current = setTimeout(() => {
      advancingRef.current = ''
      setFlash(false)
      advance()
    }, 650)
  }, [state, active, step, flash, advance, lessonId, stepIndex])

  // tidy the pending flash timer on unmount
  useEffect(() => () => clearTimeout(flashTimer.current), [])

  const restart = (cb) => {
    clearTimeout(flashTimer.current)
    initedRef.current = null
    setupKeyRef.current = ''
    advancingRef.current = ''
    setFlash(false)
    cb()
  }

  return {
    active,
    lesson,
    step,
    stepIndex,
    stepCount: steps.length,
    flash,
    paused: !!(active && step && step.pause !== false),
    highlight: active && !flash && step ? step.highlight || null : null,
    start: (id) => restart(() => { setLessonId(id); setStepIndex(0) }),
    exit: () => restart(() => { setLessonId(null); setStepIndex(0) }),
    next: () => { if (!flash) advance() },
    prev: () => { clearTimeout(flashTimer.current); setFlash(false); setStepIndex((i) => Math.max(0, i - 1)) },
    skip: () => { setFlash(false); advance() },
  }
}

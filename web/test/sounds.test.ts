import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type * as Sounds from '@/lib/sounds'

// jsdom ships no Web Audio API at all, so every assertion here runs against a fake
// AudioContext that records the exact gain automation and oscillator timing 4.1
// specifies, rather than asserting the calls happened at all.
class FakeGain {
  automation: Array<{ method: string; value: number; time: number }> = []
  gain = {
    setValueAtTime: (v: number, t: number) => { this.automation.push({ method: 'set', value: v, time: t }) },
    exponentialRampToValueAtTime: (v: number, t: number) => { this.automation.push({ method: 'ramp', value: v, time: t }) },
  }
  connect() {}
}

class FakeOscillator {
  frequency = { value: 0 }
  startedAt: number | null = null
  stoppedAt: number | null = null
  connect() {}
  start(t: number) { this.startedAt = t }
  stop(t: number) { this.stoppedAt = t }
}

class FakeAudioContext {
  currentTime = 0
  state: 'running' | 'suspended' = 'running'
  destination = {}
  oscillators: FakeOscillator[] = []
  gains: FakeGain[] = []
  resume = vi.fn(async () => { this.state = 'running' })
  createOscillator() { const o = new FakeOscillator(); this.oscillators.push(o); return o }
  createGain() { const g = new FakeGain(); this.gains.push(g); return g }
}

// The peak every envelope ramps to. Asserted equal across all three tones below: what
// tells them apart is pitch and duration, never loudness (4.1: "distinguishable ...
// rather than by volume").
const PEAK = 0.3

let fake: FakeAudioContext
let sounds: typeof Sounds

// sounds.ts holds its AudioContext in a module-level singleton (by design: 4.1's tones
// share one context rather than opening one per tap). vi.resetModules() plus a dynamic
// re-import gives every test its own singleton bound to that test's own fake, rather than
// all tests fighting over whichever fake happened to win the first getCtx() call.
beforeEach(async () => {
  fake = new FakeAudioContext()
  vi.stubGlobal('AudioContext', function AudioContextStub() { return fake })
  vi.stubGlobal('matchMedia', undefined)
  vi.resetModules()
  sounds = await import('@/lib/sounds')
})

afterEach(() => vi.unstubAllGlobals())

describe('playRegistered (a score committed)', () => {
  it('is a rising two-tone pluck: 880 then 1320 Hz, 30ms apart, 6ms attack / 24ms decay each, peaking at the shared ceiling', () => {
    sounds.playRegistered()
    expect(fake.oscillators).toHaveLength(2)
    const [first, second] = fake.oscillators
    expect(first.frequency.value).toBe(880)
    expect(second.frequency.value).toBe(1320)
    expect(first.startedAt).toBeCloseTo(0, 5)
    expect(second.startedAt).toBeCloseTo(0.03, 5)
    expect(first.stoppedAt).toBeCloseTo(0.006 + 0.024 + 0.02, 5)

    const [g1, g2] = fake.gains
    expect(g1.automation[0]).toMatchObject({ method: 'set', time: 0 })
    expect(g1.automation[1]).toMatchObject({ method: 'ramp', value: PEAK })
    expect(g1.automation[1].time).toBeCloseTo(0.006, 5)
    expect(g1.automation[2].time).toBeCloseTo(0.006 + 0.024, 5)
    expect(g2.automation[0].time).toBeCloseTo(0.03, 5)
  })

  it('never repeats internally: two calls produce two independent pairs, not a loop', () => {
    sounds.playRegistered()
    sounds.playRegistered()
    expect(fake.oscillators).toHaveLength(4)
    expect(fake.oscillators.map(o => o.frequency.value)).toEqual([880, 1320, 880, 1320])
  })
})

describe('playExpired (the clock expiring)', () => {
  it('is a sustained 220 Hz tone, 800ms total, 20ms attack, 120ms release, peaking at the shared ceiling', () => {
    sounds.playExpired()
    expect(fake.oscillators).toHaveLength(1)
    const [osc] = fake.oscillators
    expect(osc.frequency.value).toBe(220)
    expect(osc.startedAt).toBeCloseTo(0, 5)
    expect(osc.stoppedAt).toBeCloseTo(0.8 + 0.02, 5)

    const [gain] = fake.gains
    expect(gain.automation[1]).toMatchObject({ method: 'ramp', value: PEAK })
    expect(gain.automation[1].time).toBeCloseTo(0.02, 5)
    expect(gain.automation[2]).toMatchObject({ method: 'set', value: PEAK })
    expect(gain.automation[2].time).toBeCloseTo(0.8 - 0.12, 5)
    expect(gain.automation[3].time).toBeCloseTo(0.8, 5)
  })
})

describe('playRejected (an action the app refused)', () => {
  it('is two 160 Hz pulses, 60ms on / 60ms off / 60ms on, 6ms attack / 40ms decay each, peaking at the shared ceiling', () => {
    sounds.playRejected()
    expect(fake.oscillators).toHaveLength(2)
    const [first, second] = fake.oscillators
    expect(first.frequency.value).toBe(160)
    expect(second.frequency.value).toBe(160)
    expect(first.startedAt).toBeCloseTo(0, 5)
    expect(second.startedAt).toBeCloseTo(0.12, 5)
    expect(first.stoppedAt).toBeCloseTo(0.006 + 0.04 + 0.02, 5)

    const [g1] = fake.gains
    expect(g1.automation[1]).toMatchObject({ method: 'ramp', value: PEAK })
  })
})

describe('reduced audio preference', () => {
  it('plays nothing when the platform reports prefers-reduced-audio: reduce', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ media: query, matches: true }))
    sounds.playRegistered()
    sounds.playExpired()
    sounds.playRejected()
    expect(fake.oscillators).toHaveLength(0)
  })

  it('plays normally when no platform exposes the preference (every browser today)', () => {
    sounds.playRegistered()
    expect(fake.oscillators).toHaveLength(2)
  })
})

describe('unlockAudio', () => {
  it('resumes a suspended context so the first tone of the afternoon is not swallowed', () => {
    fake.state = 'suspended'
    sounds.unlockAudio()
    expect(fake.resume).toHaveBeenCalledTimes(1)
  })

  it('does nothing to an already-running context', () => {
    fake.state = 'running'
    sounds.unlockAudio()
    expect(fake.resume).not.toHaveBeenCalled()
  })
})

describe('when Web Audio itself is unavailable', () => {
  it('never throws', () => {
    vi.stubGlobal('AudioContext', undefined)
    expect(() => {
      sounds.unlockAudio()
      sounds.playRegistered()
      sounds.playExpired()
      sounds.playRejected()
    }).not.toThrow()
  })
})

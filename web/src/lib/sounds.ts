// 4.1: exactly three tones exist, one meaning each, and none may repeat internally --
// each is a near field cue for the person holding the tablet, never a room cue, so
// there is no volume ramp to reach for and no reason for a fourth.

let ctx: AudioContext | null = null

function getCtx(): AudioContext | null {
  try {
    ctx ??= new AudioContext()
    return ctx
  } catch {
    return null
  }
}

// Media Queries Level 5's prefers-reduced-audio has no shipping browser today, so this
// is a no-op everywhere until one exists: an unrecognised media feature reports no match
// rather than throwing, which is what makes the check safe to leave in permanently.
function reducedAudio(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  try {
    return window.matchMedia('(prefers-reduced-audio: reduce)').matches
  } catch {
    return false
  }
}

// iOS only plays audio started inside a user gesture. Call this from the first tap on
// the page -- the mat-code tap (6.17b) and the scorer's first pointerdown both do.
export function unlockAudio(): void {
  const c = getCtx()
  if (c?.state === 'suspended') void c.resume()
}

// One-shot attack/decay pluck: rises to peak over attackS, falls back to silence over
// decayS, and is never retriggered internally, which is what "never repeat a tone" means
// at the oscillator level, not just at the call-site level.
function pluck(c: AudioContext, freq: number, start: number, attackS: number, decayS: number, peak = 0.3): void {
  const osc = c.createOscillator()
  const gain = c.createGain()
  osc.frequency.value = freq
  osc.connect(gain)
  gain.connect(c.destination)
  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.exponentialRampToValueAtTime(peak, start + attackS)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + attackS + decayS)
  osc.start(start)
  osc.stop(start + attackS + decayS + 0.02)
}

// Attack/sustain/release: rises to peak, holds, then falls back over releaseS so the
// total envelope spans exactly totalS.
function sustain(c: AudioContext, freq: number, start: number, totalS: number, attackS: number, releaseS: number, peak = 0.3): void {
  const osc = c.createOscillator()
  const gain = c.createGain()
  osc.frequency.value = freq
  osc.connect(gain)
  gain.connect(c.destination)
  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.exponentialRampToValueAtTime(peak, start + attackS)
  gain.gain.setValueAtTime(peak, start + totalS - releaseS)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + totalS)
  osc.start(start)
  osc.stop(start + totalS + 0.02)
}

// A score committed. Two-tone rising, 880 Hz then 1320 Hz, 60ms total (30 + 30),
// 6ms attack / 24ms decay each note.
export function playRegistered(): void {
  if (reducedAudio()) return
  const c = getCtx()
  if (!c) return
  const t = c.currentTime
  pluck(c, 880, t, 0.006, 0.024)
  pluck(c, 1320, t + 0.03, 0.006, 0.024)
}

// The clock expiring. 220 Hz sustained for 800ms, 20ms attack, 120ms release.
export function playExpired(): void {
  if (reducedAudio()) return
  const c = getCtx()
  if (!c) return
  sustain(c, 220, c.currentTime, 0.8, 0.02, 0.12)
}

// An action the app refused. 160 Hz, two pulses, 180ms total (60 on / 60 off / 60 on),
// 6ms attack / 40ms decay each pulse.
export function playRejected(): void {
  if (reducedAudio()) return
  const c = getCtx()
  if (!c) return
  const t = c.currentTime
  pluck(c, 160, t, 0.006, 0.04)
  pluck(c, 160, t + 0.12, 0.006, 0.04)
}

let ctx: AudioContext | null = null

// iOS only plays audio started inside a user gesture. Call this from the first tap on the page.
export function unlockAudio(): void {
  try {
    ctx ??= new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
  } catch { /* no audio */ }
}

export function beep(times = 2): void {
  try {
    ctx ??= new AudioContext()
    let t = ctx.currentTime
    for (let i = 0; i < times; i++) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.frequency.value = 880
      osc.connect(gain)
      gain.connect(ctx.destination)
      gain.gain.setValueAtTime(0.3, t)
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3)
      osc.start(t)
      osc.stop(t + 0.3)
      t += 0.4
    }
  } catch { /* no audio */ }
}

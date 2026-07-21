// Web Audio synth for the contract clear FX (#9). No audio assets.
// ponytail: single lazy AudioContext, plain oscillator arpeggio — sampler/mixer
// only if sound design ever becomes a real requirement.

let ctx: AudioContext | null = null

function audioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  ctx ??= new AudioContext()
  return ctx
}

// C major arpeggio climbing with combo: combo 1 → 3 notes, each extra combo adds a note.
const NOTES = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1568.0] // C5 E5 G5 C6 E6 G6

export function playClearSound(combo: number): void {
  try {
    const audio = audioContext()
    if (!audio) return
    // Autoplay policy: this runs inside a click handler chain, resume is allowed.
    if (audio.state === 'suspended') void audio.resume()

    const notes = NOTES.slice(0, Math.min(2 + combo, NOTES.length))
    const gainPeak = Math.min(0.12 + 0.04 * combo, 0.3)
    notes.forEach((freq, i) => {
      const t = audio.currentTime + i * 0.09
      const osc = audio.createOscillator()
      const gain = audio.createGain()
      osc.type = 'triangle'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0, t)
      gain.gain.linearRampToValueAtTime(gainPeak, t + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35)
      osc.connect(gain).connect(audio.destination)
      osc.start(t)
      osc.stop(t + 0.4)
    })
  } catch {
    // Silent fallback — sound must never break the game flow.
  }
}

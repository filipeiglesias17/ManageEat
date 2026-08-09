import { useCallback, useEffect } from 'react'

// Tipos de som — um por evento, para o empregado distinguir sem olhar.
export type AlertSound = 'call' | 'bill' | 'ready' | 'late'

type Tone = { freq: number; at: number; dur: number }

// Cada som é uma sequência curta de tons (Web Audio sintetizado — sem ficheiros
// .mp3). `at` = início relativo em segundos; `dur` = duração do tom.
const SOUNDS: Record<AlertSound, Tone[]> = {
  // Chamada de empregado: duplo beep (o som original da app).
  call: [
    { freq: 880, at: 0, dur: 0.13 },
    { freq: 880, at: 0.2, dur: 0.13 },
  ],
  // Pedir a conta: dois tons mais graves (associação a "conta/dinheiro").
  bill: [
    { freq: 620, at: 0, dur: 0.13 },
    { freq: 620, at: 0.2, dur: 0.13 },
  ],
  // Pronto para servir: duas notas a subir (soa positivo, "está feito").
  ready: [
    { freq: 660, at: 0, dur: 0.12 },
    { freq: 988, at: 0.16, dur: 0.18 },
  ],
  // Atrasado: três beeps rápidos e agudos (soa urgente).
  late: [
    { freq: 988, at: 0, dur: 0.09 },
    { freq: 988, at: 0.13, dur: 0.09 },
    { freq: 988, at: 0.26, dur: 0.09 },
  ],
}

// Um único AudioContext partilhado por toda a app. IMPORTANTE (iOS): no WKWebView
// o áudio começa "suspenso" e só arranca DENTRO de um gesto do utilizador. Se só
// o criássemos no primeiro alerta (que vem de um callback do Realtime, não de um
// toque), nunca tocava no iPhone. Por isso desbloqueamo-lo no primeiro toque.
let sharedCtx: AudioContext | null = null

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!sharedCtx) {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextClass) return null
    sharedCtx = new AudioContextClass()
  }
  return sharedCtx
}

// Liga o desbloqueio uma só vez: ao primeiro toque no ecrã, retoma o contexto.
// Não é `once` — o iOS pode voltar a suspender, por isso reforçamos a cada toque.
let unlockBound = false
function bindAudioUnlock(): void {
  if (unlockBound || typeof window === 'undefined') return
  unlockBound = true
  const unlock = () => {
    const ctx = getAudioContext()
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {})
  }
  window.addEventListener('pointerdown', unlock)
  window.addEventListener('touchend', unlock)
}

export function useAudioAlert() {
  useEffect(() => {
    bindAudioUnlock()
  }, [])

  const playAlert = useCallback((sound: AlertSound = 'call') => {
    try {
      const ctx = getAudioContext()
      if (!ctx) return
      if (ctx.state === 'suspended') ctx.resume().catch(() => {})

      // Um oscilador por tom, com envelope curto (evita "clicks" no início/fim).
      for (const tone of SOUNDS[sound]) {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.connect(gain)
        gain.connect(ctx.destination)

        osc.type = 'sine'
        osc.frequency.setValueAtTime(tone.freq, ctx.currentTime + tone.at)

        gain.gain.setValueAtTime(0, ctx.currentTime + tone.at)
        gain.gain.linearRampToValueAtTime(0.5, ctx.currentTime + tone.at + 0.02)
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + tone.at + tone.dur)

        osc.start(ctx.currentTime + tone.at)
        osc.stop(ctx.currentTime + tone.at + tone.dur + 0.02)
      }
    } catch (e) {
      console.warn('Audio alert failed:', e)
    }
  }, [])

  return playAlert
}

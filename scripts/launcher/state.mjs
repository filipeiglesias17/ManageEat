// Estado do launcher + constantes e utilitários partilhados pelos outros
// ficheiros de scripts/launcher/.
//
// O ficheiro .launcher-state.json (na raiz do projeto, gitignored) guarda:
//   - launcherPid: PID do launcher a correr — é o "lock" de instância única
//   - bootTime:    quando a máquina arrancou, para invalidar PIDs após reboot
//   - children:    PIDs dos processos filhos (vite e proxy TLS)
//   - lastLanIp:   último IP da LAN visto, para avisar quando o IP muda
//
// O lock é auto-reparável: um PID só é de confiança se a máquina não reiniciou
// entretanto (isSameBoot), se o processo existe E se a linha de comando dele
// ainda é nossa (looksLikeOurProcess, em platform.mjs). Assim um crash ou um
// corte de energia nunca deixa o launcher "preso", e um PID reciclado pelo
// sistema nunca é confundido com (nem morto como se fosse) um processo nosso.
//
// Este ficheiro (como todo o launcher) é .mjs em Node puro, sem dependências:
// tem de conseguir correr logo a seguir ao git clone, ANTES do npm install.

import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Raiz do projeto resolvida a partir DESTE ficheiro (scripts/launcher/ → raiz),
// nunca de process.cwd(): o duplo clique num atalho pode arrancar noutra pasta.
// (Não usamos import.meta.dirname porque só existe no Node >= 20.11.)
export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

// Portas da app. Têm de bater certo com src/lib/server-ports.ts e com a porta
// do Vite — o launcher é .mjs puro e não consegue importar TypeScript, por isso
// os valores estão duplicados de propósito. Se mudares lá, muda aqui.
export const VITE_PORT = 5173
export const SUPABASE_HTTP_PORT = 54321
export const STAFF_TLS_PORT = 54391
export const STUDIO_PORT = 54323

// Sem terminal interativo (ex.: auto-arranque pelo launchd) o launcher nunca
// faz perguntas — em particular, nunca oferece o seed.
export const isInteractive = process.stdout.isTTY === true && process.stdin.isTTY === true

const stateFile = path.join(projectRoot, '.launcher-state.json')

export function readState() {
  try {
    return JSON.parse(readFileSync(stateFile, 'utf-8'))
  } catch {
    // Ficheiro não existe ou está corrompido: começamos de estado vazio.
    return {}
  }
}

export function writeState(patch) {
  const next = { version: 1, ...readState(), ...patch }
  // Escrita atómica (ficheiro temporário + rename): um corte de energia a meio
  // da escrita nunca deixa o JSON meio-escrito. O tmp leva o PID no nome para
  // dois processos concorrentes não pisarem o mesmo ficheiro temporário.
  const tmp = `${stateFile}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`)
  renameSync(tmp, stateFile)
  return next
}

export function isPidAlive(pid) {
  if (!pid) return false
  try {
    // Sinal 0 = "não faz nada, só diz se o processo existe".
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

// Identidade do arranque da máquina. Depois de um reboot o sistema RECICLA os
// números de PID — um PID guardado antes do reboot pode agora pertencer a um
// programa inocente. Por isso um PID do estado só é de confiança se a máquina
// não reiniciou desde que ele foi escrito.
export function currentBootTime() {
  return Date.now() - Math.round(os.uptime() * 1000)
}

export function isSameBoot(state) {
  if (!state.bootTime) return false
  // Tolerância de 60s porque o cálculo do bootTime deriva um pouco entre chamadas.
  return Math.abs(state.bootTime - currentBootTime()) < 60_000
}

// ── Mensagens no terminal (PT-PT, pensadas para quem não é técnico) ─────────
export function info(msg) {
  console.log(`• ${msg}`)
}
export function ok(msg) {
  console.log(`✓ ${msg}`)
}
export function warn(msg) {
  console.warn(`! ${msg}`)
}
export function fail(msg) {
  console.error(`✖ ${msg}`)
}

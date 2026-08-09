// Entrega de ficheiros gerados (análises) ao utilizador.
//
// No browser: download normal (criar URL, <a download>, click, revoke).
// No app NATIVO (iOS/Android via Capacitor): o WebView NÃO suporta o
// `<a download>` nem URLs `blob:`  o clique não faz nada. Por isso gravamos o
// ficheiro no dispositivo (Filesystem) e abrimos a folha de partilha (Share),
// onde o utilizador escolhe Guardar em Ficheiros, enviar por email, etc.

import { Capacitor } from '@capacitor/core'

export type DownloadItem = { blob: Blob; filename: string }

// Marca de ordem de bytes UTF-8. O Excel precisa dela para abrir CSV com
// acentos (ç, ã, é) sem os estragar; por isso é opcional via `withBom`.
const UTF8_BOM = new Uint8Array([0xEF, 0xBB, 0xBF])

// Envolve texto num Blob (com BOM UTF-8 opcional). Útil para CSV/XML.
export function textToBlob(text: string, mime: string, withBom = false): Blob {
  if (withBom) return new Blob([UTF8_BOM, text], { type: mime })
  return new Blob([text], { type: mime })
}

// Entrega 1+ ficheiros ao utilizador, escolhendo o caminho certo por plataforma.
export async function downloadFiles(items: DownloadItem[]): Promise<void> {
  if (items.length === 0) return

  if (Capacitor.isNativePlatform()) {
    await shareFilesNative(items)
    return
  }

  // Web: um download por ficheiro.
  items.forEach((item) => triggerBrowserDownload(item.blob, item.filename))
}

// Conveniências de 1 ficheiro (a maioria dos formatos exporta um só).
export async function downloadBlob(blob: Blob, filename: string): Promise<void> {
  await downloadFiles([{ blob, filename }])
}

export async function downloadText(
  text: string,
  filename: string,
  mime: string,
  withBom = false,
): Promise<void> {
  await downloadFiles([{ blob: textToBlob(text, mime, withBom), filename }])
}

//  Web

function triggerBrowserDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  // Libertar a URL temporária  senão fica em memória até fechar a aba.
  URL.revokeObjectURL(url)
}

//  Nativo (iOS/Android)

async function shareFilesNative(items: DownloadItem[]): Promise<void> {
  // Os plugins nativos só existem no binário; uma atualização OTA traz só o JS.
  // Se o JS estiver à frente do binário instalado, damos uma mensagem acionável
  // em vez do críptico "Filesystem plugin is not implemented".
  if (!Capacitor.isPluginAvailable('Filesystem') || !Capacitor.isPluginAvailable('Share')) {
    throw new Error('Reinstala a app para exportar (esta atualização precisa da nova versão nativa, não chega a atualização automática).')
  }

  // Imports dinâmicos: estes plugins só existem no binário nativo. Mantê-los
  // fora do caminho web evita carregá-los no browser.
  const { Filesystem, Directory } = await import('@capacitor/filesystem')
  const { Share } = await import('@capacitor/share')

  // Grava cada ficheiro na Cache (temporário, só para partilhar) e guarda a URI.
  const uris: string[] = []
  for (const item of items) {
    const base64 = await blobToBase64(item.blob)
    const written = await Filesystem.writeFile({
      path: item.filename,
      data: base64,
      directory: Directory.Cache,
    })
    uris.push(written.uri)
  }

  // Partilhar vários de uma vez quando o plugin suporta `files`; caso contrário,
  // partilhar o primeiro por `url` (fallback para versões antigas do plugin).
  //
  // Cuidado: se o utilizador FECHA a folha de partilha, o plugin rejeita com
  // "Share canceled". Isso é uma desistência, não uma falha  abortamos em
  // silêncio e NUNCA reabrimos a partilha. (Antes, este catch reabria a folha ao
  // cancelar e parecia um segundo download antes de falhar.)
  const title = items[0].filename
  const dialogTitle = 'Guardar ou partilhar'
  try {
    await Share.share({ title, files: uris, dialogTitle })
  } catch (err) {
    if (isShareCanceled(err)) return
    // Erro genuíno (ex.: plugin antigo sem suporte a `files`) → tentar por `url`.
    try {
      await Share.share({ title, url: uris[0], dialogTitle })
    } catch (fallbackErr) {
      if (isShareCanceled(fallbackErr)) return
      throw fallbackErr
    }
  }
}

// O plugin Share rejeita com "Share canceled" (iOS e Android) quando o
// utilizador fecha a folha de partilha sem escolher nada. Tratamos isso como
// desistência, não como erro.
function isShareCanceled(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return message.toLowerCase().includes('cancel')
}

// Blob → base64 puro (sem o prefixo "data:...;base64,"), como o Filesystem espera.
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('Falha a ler o ficheiro a exportar.'))
    reader.onloadend = () => {
      const result = String(reader.result)
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.readAsDataURL(blob)
  })
}

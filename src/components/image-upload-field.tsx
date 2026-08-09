import { useState, useRef, type ChangeEvent } from 'react'
import { ImagePlus, X, Loader2 } from 'lucide-react'
import { uploadMenuImage, deleteMenuImage } from '../lib/db'
import { resolveStorageUrl } from '../lib/supabase'

interface Props {
  value: string // URL atual ('' = sem imagem)
  onChange: (url: string) => void
}

const MAX_BYTES = 5 * 1024 * 1024 // 5 MB

// Campo de imagem do item: faz upload para o Supabase Storage e devolve a URL
// pública ao formulário. Mostra pré-visualização e deixa remover. A escrita no
// bucket está limitada a admin/gerente pela RLS do storage — aqui só validamos o
// ficheiro (ser imagem e não passar do limite) antes de enviar.
export function ImageUploadField({ value, onChange }: Props) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  // URLs carregadas nesta sessão do form (ainda não guardadas). Só estas é que o
  // componente pode apagar do storage — a imagem original do item nunca, que essa
  // só se limpa ao guardar (no admin-dashboard).
  const sessionUploads = useRef<Set<string>>(new Set())

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setError('')
    if (!file.type.startsWith('image/')) { setError('Escolhe um ficheiro de imagem.'); return }
    if (file.size > MAX_BYTES) { setError('Imagem demasiado grande (máx. 5 MB).'); return }

    setUploading(true)
    try {
      const url = await uploadMenuImage(file)
      // Se estamos a substituir uma imagem carregada nesta sessão (não guardada),
      // apaga a anterior para não ficar órfã no storage.
      if (value && sessionUploads.current.has(value)) deleteMenuImage(value)
      sessionUploads.current.add(url)
      onChange(url)
    } catch (err) {
      setError(`Não foi possível enviar a imagem: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setUploading(false)
      // Limpar o input para poder re-selecionar o mesmo ficheiro a seguir.
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm text-zinc-400">Imagem</label>

      {value ? (
        <div className="relative w-full">
          <img src={resolveStorageUrl(value)} alt="Pré-visualização do item" className="w-full h-32 object-cover rounded-sm border border-zinc-800" />
          <button
            type="button"
            onClick={() => {
              // Só apaga do storage se a imagem foi carregada nesta sessão; a
              // original do item limpa-se ao guardar, não aqui.
              if (sessionUploads.current.has(value)) {
                deleteMenuImage(value)
                sessionUploads.current.delete(value)
              }
              onChange('')
            }}
            aria-label="Remover imagem"
            className="absolute top-1.5 right-1.5 bg-black/60 hover:bg-black/80 rounded-full p-1 text-zinc-200"
          >
            <X className="size-4" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="flex items-center justify-center gap-2 h-24 rounded-sm border border-dashed border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-300 disabled:opacity-50 transition-colors"
        >
          {uploading ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
          {uploading ? 'A enviar…' : 'Carregar imagem'}
        </button>
      )}

      <input ref={inputRef} type="file" accept="image/*" onChange={handleFile} className="hidden" />
      {error && <p className="text-red-400 text-xs" role="alert">{error}</p>}
    </div>
  )
}

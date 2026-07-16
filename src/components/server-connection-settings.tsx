import { useState, type FormEvent } from 'react'
import { Loader2, CheckCircle2, ServerCog } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { checkUrlHealth, refreshConnection } from '../lib/network-discovery'
import { getServerOverride, setServerOverride, clearServerOverride, rememberLastGoodServer, getCurrentSupabaseUrl } from '../lib/supabase'
import { parsePort, buildServerUrl, normalizeServerUrl } from '../lib/validation'
import { useDict } from '../lib/i18n'

interface Props {
  // Fecha o modal de definições (fornecido por quem o abre: BootScreen ou Login).
  onClose: () => void
}

// Definições de ligação: deixa apontar manualmente este dispositivo ao servidor
// do restaurante (Supabase). Útil quando o servidor está noutro IP/porta e a
// deteção automática não chega lá. O que for gravado ganha sempre e persiste.
// Separa o servidor atual (ex.: "http://192.168.1.67:54321") em host e porta,
// para os pré-preencher nos campos como valores editáveis. Assim o IP aparece
// já escrito (como a porta), em vez de ser só um placeholder cinzento.
function parseHostPort(rawUrl: string): { host: string; port: string } {
  try {
    const parsed = new URL(rawUrl)
    return { host: parsed.hostname, port: parsed.port || '54321' }
  } catch {
    return { host: '', port: '54321' }
  }
}

export function ServerConnectionSettings({ onClose }: Props) {
  const d = useDict()
  const existingOverride = getServerOverride()
  // Servidor a que o dispositivo está ligado agora (override manual ou o do
  // build). Mostramos estes valores já preenchidos e editáveis.
  const currentUrl = getCurrentSupabaseUrl()
  const current = parseHostPort(currentUrl)

  const [advanced, setAdvanced] = useState(false)
  const [host, setHost] = useState(current.host)
  const [port, setPort] = useState(current.port)
  const [fullUrl, setFullUrl] = useState(existingOverride ?? currentUrl)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState('')

  // Constrói o URL final a partir do modo ativo. Devolve null se for inválido.
  function buildUrl(): string | null {
    if (advanced) return normalizeServerUrl(fullUrl)
    const parsedPort = parsePort(port)
    if (parsedPort === null) return null
    return buildServerUrl(host, parsedPort)
  }

  async function handleTestAndConnect(e: FormEvent) {
    e.preventDefault()
    setError('')

    const url = buildUrl()
    if (!url) {
      setError(
        advanced
          ? d.settings.connection.invalidUrl
          : d.settings.connection.invalidHostPort,
      )
      return
    }

    setTesting(true)
    try {
      // Validar com o mesmo health check do arranque antes de gravar.
      const alive = await checkUrlHealth(url)
      if (!alive) {
        setError(d.settings.connection.unreachable)
        return
      }
      // Sucesso: gravar (persiste + aplica ao cliente) e reavaliar o estado.
      // Lembrar também como "último bom": se mais tarde voltar ao automático,
      // este servidor continua a ser tentado antes do IP queimado no build.
      const previousUrl = getCurrentSupabaseUrl()
      setServerOverride(url)
      rememberLastGoodServer(url)
      await refreshConnection()

      // Trocar de servidor recria o cliente Supabase por baixo. O listener de
      // auth (AuthProvider) ficou preso ao cliente antigo, por isso um login a
      // seguir não seria detetado e o utilizador ficava preso no Login.
      // Recarregar reabre o arranque inteiro já no cliente certo (o servidor
      // fica gravado em localStorage). Só recarregamos se mudou mesmo.
      if (getCurrentSupabaseUrl() !== previousUrl) {
        window.location.reload()
        return
      }
      onClose()
    } finally {
      setTesting(false)
    }
  }

  function handleReset() {
    // Mesmo motivo do handleTestAndConnect: voltar ao automático pode trocar o
    // cliente Supabase; recarregar garante que o auth re-subscreve no certo.
    const previousUrl = getCurrentSupabaseUrl()
    clearServerOverride()
    if (getCurrentSupabaseUrl() !== previousUrl) {
      window.location.reload()
      return
    }
    refreshConnection()
    onClose()
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <ServerCog className="size-5 text-brand" />
        <h2 id="conn-settings-title" className="text-lg font-semibold text-foreground">
          {d.settings.connection.title}
        </h2>
      </div>
      <p className="text-sm text-muted-foreground mb-5">
        {d.settings.connection.description}
      </p>

      <form onSubmit={handleTestAndConnect} className="space-y-4">
        {!advanced ? (
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 flex flex-col gap-1.5">
              <Label htmlFor="conn-host">{d.settings.connection.hostLabel}</Label>
              <Input
                id="conn-host"
                // 'url' (e não 'decimal') porque o teclado decimal do iOS em PT
                // só dá vírgula — sem ponto não dava para escrever o IP. O teclado
                // 'url' tem ponto e dígitos. autoCorrect/Capitalize off: o iOS não
                // tenta "corrigir" o endereço.
                inputMode="url"
                placeholder={d.settings.connection.hostPlaceholder}
                value={host}
                onChange={(e) => setHost(e.target.value)}
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="conn-port">{d.settings.connection.portLabel}</Label>
              <Input
                id="conn-port"
                inputMode="numeric"
                placeholder={d.settings.connection.portPlaceholder}
                value={port}
                onChange={(e) => setPort(e.target.value)}
                autoComplete="off"
              />
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="conn-url">{d.settings.connection.urlLabel}</Label>
            <Input
              id="conn-url"
              // Mesma blindagem do campo simples: é por aqui que o utilizador
              // liga a 1.ª vez (teclado de texto tem ponto), por isso o iOS não
              // pode "autocorrigir" nem capitalizar o URL.
              inputMode="url"
              placeholder={d.settings.connection.urlPlaceholder}
              value={fullUrl}
              onChange={(e) => setFullUrl(e.target.value)}
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoFocus
            />
          </div>
        )}

        {/* Alternar simples ↔ avançado. Botão simples (não Button) para ser discreto. */}
        <button
          type="button"
          onClick={() => {
            setAdvanced((v) => !v)
            setError('')
          }}
          className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
        >
          {advanced ? d.settings.connection.useSimple : d.settings.connection.useAdvanced}
        </button>

        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}

        <div className="flex flex-col gap-2 pt-1">
          <Button type="submit" disabled={testing} className="w-full">
            {testing ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                {d.settings.connection.submitting}
              </>
            ) : (
              <>
                <CheckCircle2 className="size-4" />
                {d.settings.connection.submit}
              </>
            )}
          </Button>

          {existingOverride && (
            <Button
              type="button"
              variant="ghost"
              onClick={handleReset}
              className="w-full text-muted-foreground"
            >
              {d.settings.connection.resetToAuto}
            </Button>
          )}

          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            className="w-full text-muted-foreground"
          >
            {d.common.cancel}
          </Button>
        </div>
      </form>
    </div>
  )
}

import { useState, type FormEvent } from 'react'
import { Eye, EyeOff, ServerCog } from 'lucide-react'
import { Capacitor } from '@capacitor/core'
import { Keyboard } from '@capacitor/keyboard'
import { supabase, usernameToEmail, setRememberSession } from '../lib/supabase'
import { useDict } from '../lib/i18n'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Spinner } from '@/components/ui/spinner'
import { Modal } from '../components/modal'
import { ServerConnectionSettings } from '../components/server-connection-settings'
import { UpdateBanner } from '../components/update-banner'
import { SettingsMenu } from '../components/settings-menu'
import { Wordmark } from '../components/wordmark'

// Só faz sentido apontar o servidor manualmente em nativo (no browser fala-se
// direto com o Supabase). Fora do Capacitor, escondemos a entrada das definições.
const isCapacitor = typeof window !== 'undefined' && !!(window as Window & { Capacitor?: unknown }).Capacitor

export function Login() {
  const d = useDict()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  // Definições de ligação acessíveis a partir do Login: deixa mudar o servidor
  // do dispositivo sem ter de forçar uma desligação para chegar ao ecrã de erro.
  const [showSettings, setShowSettings] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    // Em nativo, esconder o teclado ao submeter (UX mais limpa no telemóvel).
    if (Capacitor.isNativePlatform()) Keyboard.hide().catch(() => {})

    if (!username.trim() || !password.trim()) {
      setError(d.login.errors.fillBothFields)
      return
    }

    setLoading(true)
    try {
      // Persistência: local => sobrevive a fechar o browser; session => só
      // nesta tab. Tem de ser definida ANTES do signIn para o token ir para o
      // storage certo (ver setRememberSession em lib/supabase.ts).
      setRememberSession(remember)

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: usernameToEmail(username),
        password,
      })
      if (signInError) throw signInError

      // O AuthContext ouve onAuthStateChange e faz o resto (fetch do profile,
      // render das rotas). Não guardamos nada em localStorage manualmente.
    } catch (err) {
      // Normalizar os erros do Supabase Auth para mensagens legíveis. Os erros
      // trazem `code` (ex.: 'invalid_credentials') e/ou `status` (ex.: 429).
      const code = err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : ''
      const status = err && typeof err === 'object' && 'status' in err ? Number((err as { status: unknown }).status) : 0
      const name = err instanceof Error ? err.name : ''
      if (code === 'invalid_credentials' || code === 'invalid_grant') {
        setError(d.login.errors.invalidCredentials)
      } else if (code === 'over_request_rate_limit' || status === 429) {
        setError(d.login.errors.tooManyAttempts)
      } else if (name === 'AuthRetryableFetchError') {
        setError(d.login.errors.serverUnreachable)
      } else {
        setError(d.login.errors.generic)
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen pt-safe bg-background text-foreground flex items-center justify-center px-4">
      {/* Aviso de atualização OTA como barra no topo do ecrã (nativo), fora da
          coluna centrada para não parecer uma tira solta sobre o cartão. pt-safe
          para não ficar sob o notch. O UpdateBanner devolve null quando não há
          nada a mostrar. */}
      {isCapacitor && (
        <div className="fixed inset-x-0 top-0 z-50 pt-safe">
          <UpdateBanner />
        </div>
      )}

      {/* Definições no canto: mesmo menu (idioma + tema) das páginas de
          utilizador. O Login é a porta de entrada, por isso deixa escolher
          idioma e claro/escuro antes de entrar. Sem sessão iniciada o menu
          mostra só idioma e tema (o "Mudar password" fica escondido). pt com a
          safe-area para não ficar sob o notch. */}
      <div className="fixed top-0 right-0 z-40 px-2 pt-[calc(env(safe-area-inset-top)+0.5rem)]">
        <SettingsMenu />
      </div>

      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex justify-center mb-8">
          <Wordmark className="h-10 w-auto" />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl tracking-tight">{d.login.title}</CardTitle>
            <CardDescription>{d.login.subtitle}</CardDescription>
          </CardHeader>

          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="flex flex-col gap-2">
                <Label htmlFor="login-username">{d.login.usernameLabel}</Label>
                <Input
                  id="login-username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  // O iOS capitaliza a 1.ª letra por defeito; nos usernames isso
                  // é indesejado (são minúsculas e viram email técnico no login).
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  autoFocus
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="login-password">{d.login.passwordLabel}</Label>
                <div className="relative">
                  <Input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    className="pr-10"
                  />
                  {/* Adorno do input: botão simples (não o componente Button) para
                      não herdar o fundo de hover por cima do campo. Alvo de toque
                      maior (size-7) e focus ring visível por acessibilidade. */}
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? d.common.password.hide : d.common.password.show}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 flex size-7 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </div>

              <Label className="flex items-center gap-2 cursor-pointer select-none font-normal text-muted-foreground">
                <Checkbox
                  checked={remember}
                  onCheckedChange={(checked) => setRemember(checked === true)}
                />
                <span>{d.login.rememberMe}</span>
              </Label>

              {/* Alert já traz role="alert" na variante destructive. */}
              {error && <Alert variant="destructive">{error}</Alert>}

              {/* Botão principal: size lg (altura de toque do staff) e estado de
                  loading explícito (spinner + texto) em vez de só mudar o label. */}
              <Button type="submit" disabled={loading} size="lg" className="w-full">
                {loading ? (
                  <>
                    <Spinner className="size-4" />
                    {d.login.submitting}
                  </>
                ) : (
                  d.login.submit
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        {isCapacitor && (
          <button
            type="button"
            onClick={() => setShowSettings(true)}
            className="mt-6 mx-auto flex items-center justify-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <ServerCog className="size-3.5" />
            {d.login.connectionSettings}
          </button>
        )}

        {/* Centrar o logótipo com o texto. Como o 'g' (Manage) tem descender, a
            massa legível das letras fica acima do centro da caixa; empurramos o
            logo ~1,5px para baixo (≈ metade do descender) para a parte legível
            ficar opticamente centrada, com o 'g' a ultrapassar em baixo. */}
        <footer className="flex items-center justify-center gap-1.5 mt-6">
          <span className="text-xs text-muted-foreground">{d.common.poweredBy}</span>
          <Wordmark className="h-3.5 w-auto opacity-40 translate-y-[1.5px]" />
        </footer>
      </div>

      {showSettings && (
        <Modal onClose={() => setShowSettings(false)} aria-labelledby="conn-settings-title">
          <ServerConnectionSettings onClose={() => setShowSettings(false)} />
        </Modal>
      )}
    </div>
  )
}

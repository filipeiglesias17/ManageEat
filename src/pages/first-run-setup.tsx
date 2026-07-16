import { useState, type FormEvent } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Capacitor } from '@capacitor/core'
import { Keyboard } from '@capacitor/keyboard'
import { supabase, usernameToEmail } from '../lib/supabase'
import { bootstrapFirstAdmin } from '../lib/db/system'
import { useDict } from '../lib/i18n'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { ThemeToggle } from '../components/theme-toggle'
import { Wordmark } from '../components/wordmark'

// Mínimo de password igual ao de criar utilizadores (users-tab.tsx): 12.
const MIN_PASSWORD = 12
// A RPC bootstrap_first_admin exige username >= 3; validamos o mesmo aqui para
// a mensagem chegar antes do pedido, em vez de vir 'username_invalido' da BD.
const MIN_USERNAME = 3

// Ecrã de PRIMEIRA INSTALAÇÃO: só aparece quando o restaurante ainda não tem
// nenhum admin (o Boot verifica com systemNeedsSetup). Cria a conta de
// administrador com a password escolhida pelo próprio. Depois de existir admin,
// este ecrã nunca mais aparece — ver src/main.tsx e a migração
// 20260705140000_first_run_bootstrap.sql.
export function FirstRunSetup() {
  const d = useDict()
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (Capacitor.isNativePlatform()) Keyboard.hide().catch(() => {})

    const user = username.trim()
    if (user.length < MIN_USERNAME) {
      setError(d.login.setup.usernameTooShort(MIN_USERNAME))
      return
    }
    if (password.length < MIN_PASSWORD) {
      setError(d.common.password.tooShort(MIN_PASSWORD))
      return
    }
    if (password !== confirmPassword) {
      setError(d.common.password.mismatch)
      return
    }

    setLoading(true)
    try {
      // 1) Criar a conta de autenticação pelo caminho normal do browser (o mesmo
      //    de adminCreateUser). Sem confirmação de email (config local), isto já
      //    deixa a sessão iniciada para o passo seguinte.
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: usernameToEmail(user),
        password,
      })
      if (signUpError) throw signUpError
      // identities vazio = o email já existia (não devia num setup limpo).
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        setError(d.login.setup.usernameTaken)
        await supabase.auth.signOut()
        return
      }

      // 2) Promover o utilizador atual a admin (RPC guardada: só se ainda não
      //    existir admin). É aqui que a conta ganha acesso à app.
      const result = await bootstrapFirstAdmin(user)
      if (!result.ok) {
        // Corrida rara: outra instalação criou o admin entretanto. Não deixamos
        // uma sessão sem profile pendurada.
        await supabase.auth.signOut()
        if (result.reason === 'ja_existe_admin') {
          setError(d.login.setup.alreadyConfigured)
        } else {
          setError(d.login.setup.setupFailed)
        }
        return
      }

      // 3) Sucesso: recarregar do zero para o Boot reavaliar — agora existe
      //    profile para este utilizador, por isso a app entra no painel de admin.
      window.location.replace('/')
    } catch (err) {
      const name = err instanceof Error ? err.name : ''
      if (name === 'AuthRetryableFetchError') {
        setError(d.login.errors.serverUnreachable)
      } else {
        setError(d.login.setup.createFailed)
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen pt-safe bg-background text-foreground flex items-center justify-center px-4">
      <div className="fixed top-0 right-0 z-40 px-2 pt-[calc(env(safe-area-inset-top)+0.5rem)]">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-8">
          <Wordmark className="h-10 w-auto" />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl tracking-tight">{d.login.setup.title}</CardTitle>
            <CardDescription>
              {d.login.setup.subtitle}
            </CardDescription>
          </CardHeader>

          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="flex flex-col gap-2">
                <Label htmlFor="setup-username">{d.login.setup.usernameLabel}</Label>
                <Input
                  id="setup-username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  autoFocus
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="setup-password">{d.login.passwordLabel}</Label>
                <div className="relative">
                  <Input
                    id="setup-password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? d.common.password.hide : d.common.password.show}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 flex size-7 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">{d.common.password.minHint(MIN_PASSWORD)}</p>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="setup-confirm">{d.common.password.confirmLabel}</Label>
                <Input
                  id="setup-confirm"
                  type={showPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </div>

              {error && <Alert variant="destructive">{error}</Alert>}

              <Button type="submit" disabled={loading} size="lg" className="w-full">
                {loading ? (
                  <>
                    <Spinner className="size-4" />
                    {d.login.setup.submitting}
                  </>
                ) : (
                  d.login.setup.submit
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground text-center mt-6">
          {d.login.setup.footnote}
        </p>
      </div>
    </div>
  )
}

import { Component, type ReactNode } from 'react'
import { RefreshCw } from 'lucide-react'
import { Wordmark } from '../components/wordmark'
import { dict } from '../lib/i18n'
import { Button } from '@/components/ui/button'

type ErrorBoundaryProps = {
  children: ReactNode
}

type ErrorBoundaryState = {
  hasError: boolean
}

// Rede de segurança contra ecrã branco: um erro de render (ou de um import()
// de chunk lazy, por exemplo se o OTA trocou os hashes dos ficheiros entre o
// carregamento da página e o clique numa rota) deixava a app sem UI nenhuma.
// Um Error Boundary só apanha erros de render/lifecycle — erros em handlers
// async (ex.: onClick que falha um await) não passam por aqui, e está certo
// assim: o objetivo deste componente é só o "não ficar em branco".
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: unknown) {
    console.error('ErrorBoundary apanhou um erro de render:', error)
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children
    }

    // Componente de classe: não pode usar o hook useDict, por isso lê o
    // dicionário ativo com dict() (a mesma fonte, sem reatividade a hooks).
    const d = dict()

    return (
      <div className="min-h-screen pt-[calc(env(safe-area-inset-top)+1rem)] px-4 pb-4 bg-background text-foreground flex flex-col items-center justify-center">
        <div className="w-full max-w-md bg-card border border-border p-8 rounded-2xl flex flex-col items-center gap-6 shadow-sm text-center">
          <Wordmark className="h-14 w-auto mb-2" />
          <div className="flex flex-col items-center gap-1">
            <p className="text-foreground text-sm font-medium">{d.layout.errorBoundary.title}</p>
            <p className="text-muted-foreground text-xs px-4">
              {d.layout.errorBoundary.description}
            </p>
          </div>
          <Button variant="secondary" size="sm" className="w-full" onClick={() => window.location.reload()}>
            <RefreshCw className="size-3.5" />
            {d.layout.errorBoundary.reloadButton}
          </Button>
        </div>
      </div>
    )
  }
}

import { Clock } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { useDict } from '../lib/i18n'

// Aviso reutilizável "fora de turno" (regra D1). Sem botão próprio de
// propósito: o picar vive na ShiftStatusBar, que está sempre visível mesmo
// por cima deste aviso — dois botões de picar confundiam.
export function ShiftGateBanner() {
  const d = useDict()
  return (
    <Alert variant="warning" icon={<Clock />} className="mb-4">
      <AlertTitle>{d.layout.shiftGateBanner.title}</AlertTitle>
      <AlertDescription className="mt-1">
        {d.layout.shiftGateBanner.description}
      </AlertDescription>
    </Alert>
  )
}

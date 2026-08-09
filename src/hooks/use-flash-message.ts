import { useEffect, useRef, useState } from 'react'

// Mensagem temporária que aparece e desaparece sozinha após `ms`.
// Guarda o timer numa ref e limpa-o no unmount — sem isto, sair da página
// dentro dos 3s fazia um setState depois do componente desmontar (warning do
// React). Usado nos feedbacks de "pedido enviado" do cliente e do empregado.
export function useFlashMessage(ms = 3000) {
  const [message, setMessage] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function flash(text: string) {
    setMessage(text)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setMessage(''), ms)
  }

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  return [message, flash] as const
}

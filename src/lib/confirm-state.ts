// Lógica pura do "confirmar inline por-linha" (usado pelo hook
// useConfirmingId em src/hooks/). Isolada aqui, sem React, para dar para
// testar sem montar componentes.
//
// O problema que isto resolve: numa tabela com várias linhas, "estou a
// confirmar" não pode ser um único booleano — senão clicar em "apagar" numa
// linha põe todas as linhas em modo confirmação ao mesmo tempo. Por isso
// guardamos o id (string) da linha a confirmar, não um boolean.

// Alterna: clicar na mesma linha que já está a confirmar cancela; clicar
// noutra linha troca para essa. Assim só há sempre, no máximo, uma linha em
// confirmação.
export function toggleConfirmingId(currentId: string | null, clickedId: string): string | null {
  if (currentId === clickedId) return null
  return clickedId
}

// Depois de confirmar a ação (ou cancelar), volta ao estado "nenhuma linha em
// confirmação" — mas só se ainda for a mesma linha (evita apagar a
// confirmação de uma linha nova se a resposta de uma ação antiga chegar tarde).
export function clearConfirmingId(currentId: string | null, idToClear: string): string | null {
  if (currentId !== idToClear) return currentId
  return null
}

// Tema partilhado do "chrome" dos gráficos das Análises (cores lidas das CSS
// vars do tema ativo) + rótulos de quadrantes em linguagem de dono. Ficheiro
// separado dos componentes por causa do fast-refresh (só componentes em .tsx
// com JSX exportado).

import { QUADRANT_META } from '../../lib/stats'

// Lê uma CSS var do tema no momento do render (reativo a claro/escuro).
// Usado só no "chrome" dos gráficos Recharts (grelha, eixos, tooltip),
// que recebem cores por prop JS e não conseguem usar classes Tailwind.
export const readVar = (name: string, fallback: string): string =>
  (typeof window !== 'undefined'
    ? getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    : '') || fallback

// Tooltip dos gráficos. Construído como função para ler as CSS vars do tema
// a cada render (claro/escuro), em vez de cores fixas.
export function chartTooltipTheme() {
  return {
    contentStyle: {
      background: readVar('--popover', '#18181b'),
      border: `1px solid ${readVar('--border', '#27272a')}`,
      borderRadius: '8px',
      fontSize: '12px',
      padding: '10px 14px',
      boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.5)',
    },
    labelStyle: { color: readVar('--muted-foreground', '#71717a'), fontWeight: 500, marginBottom: '4px' },
    itemStyle: { color: readVar('--popover-foreground', '#f4f4f5'), fontWeight: 600 as const },
  }
}

// Nomes dos quadrantes em linguagem de dono de restaurante (os POS portugueses
// não expõem jargão de "engenharia de menu"). Os cálculos e cores continuam a
// vir de QUADRANT_META em stats.ts — aqui só se traduz a apresentação.
export const QUADRANT_LABELS_UI: Record<keyof typeof QUADRANT_META, string> = {
  estrela: 'Estrelas',
  popular: 'Muito vendidos, pouca receita',
  nicho: 'Boa receita, poucas vendas',
  fraco: 'A rever',
}

// Ação recomendada por quadrante, na mesma linguagem direta.
export const QUADRANT_HINTS_UI: Record<keyof typeof QUADRANT_META, string> = {
  estrela: 'Muito pedidos e muita receita — proteger e destacar.',
  popular: 'Saem muito mas rendem pouco — subir preço ou sugerir extras.',
  nicho: 'Rendem bem mas saem pouco — dar mais visibilidade no menu.',
  fraco: 'Saem pouco e rendem pouco — rever a ficha ou tirar do menu.',
}

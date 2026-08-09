// Tema partilhado das Análises: cor da marca e formatação de euros. Usado pela
// página `admin-stats.tsx` (gráficos) e pelos cartões em `components/stats-cards.tsx`.

import { formatEuro } from './helpers'

// A cor vem dos tokens CSS (index.css) em vez de um hex fixo: SVG/Recharts
// aceitam var() em fill/stroke/stopColor, por isso os gráficos trocam de cor
// sozinhos quando o tema muda — e um rebranding futuro só mexe no index.css.
export const BRAND = 'var(--brand)'

// Mantido como `euro` por conveniência dos gráficos; delega na formatação única
// em português (ex: "12,50 €"), ver formatEuro em helpers.ts.
export const euro = (n: number) => formatEuro(n)

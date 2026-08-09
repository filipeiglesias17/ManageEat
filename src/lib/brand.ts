// Cor da marca — o azul da palavra "Eat" no logótipo (#1759d2). Fonte ÚNICA da
// cor da marca para tudo o que vive FORA do CSS: documentos exportados (PDF do
// jsPDF, livro Excel do ExcelJS) e qualquer código que precise da cor em código.
//
// No CSS (src/index.css) a mesma cor está nos tokens --brand/--primary; aqui
// repetimo-la em formatos que essas bibliotecas percebem (tuplo RGB para o
// jsPDF, string ARGB para o ExcelJS). Se a marca mudar, muda-se nos dois sítios.

// Azul "Eat" — extraído do pixel dominante do logótipo (public/manage-eat-logo).
export const BRAND_HEX = '#1759d2'

// jsPDF recebe cores como tuplo [r, g, b] (0–255).
export const BRAND_RGB: [number, number, number] = [23, 89, 210]

// Tom mais escuro (hover/pressed no CSS; totais/realces nos documentos).
export const BRAND_DARK_RGB: [number, number, number] = [18, 74, 174]

// Tinta muito clara da marca — linhas alternadas / bandas suaves nas tabelas.
export const BRAND_TINT_RGB: [number, number, number] = [238, 243, 253]

// ExcelJS recebe cores como ARGB (8 hex: AA RR GG BB), alfa "FF" = opaco.
export const BRAND_ARGB = 'FF1759D2'
export const BRAND_DARK_ARGB = 'FF124AAE'
export const BRAND_TINT_ARGB = 'FFEEF3FD'

// Tons neutros reutilizados nos documentos (texto/linhas), para manter a mesma
// paleta que a app (zinc): tinta principal, texto secundário e linhas ténues.
export const INK_RGB: [number, number, number] = [24, 24, 27] // zinc-900
export const MUTED_RGB: [number, number, number] = [113, 113, 122] // zinc-500
export const HAIRLINE_RGB: [number, number, number] = [228, 228, 231] // zinc-200

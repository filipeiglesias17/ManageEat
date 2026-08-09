// Bandeiras em SVG inline para o seletor de idioma (PT/EN). Usamos SVG e não
// emoji (🇵🇹/🇬🇧) porque os emoji de bandeira não renderizam em todas as
// plataformas — no Windows, por exemplo, aparecem só as letras "PT"/"GB". Assim
// o desenho é idêntico em iOS, Android, macOS e no browser.
//
// Cada bandeira desenha num viewBox 30×20 (proporção 3:2) e recorta os cantos
// com um clip arredondado para ficar como uma "pastilha" limpa na UI. O tamanho
// final vem da className de quem usa (ex.: `h-3.5 w-5`).

import { cn } from '@/lib/utils'

// Bandeira de Portugal: campo verde (2/5) + vermelho (3/5) com a esfera
// armilar dourada e o escudo branco sobre a divisão. Simplificada para tamanho
// de ícone, mas reconhecível.
export function FlagPT({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 30 20"
      className={cn('h-3.5 w-5 shrink-0 rounded-[3px]', className)}
      role="img"
      aria-hidden="true"
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <clipPath id="flag-pt-round">
          <rect width="30" height="20" rx="2.5" />
        </clipPath>
      </defs>
      <g clipPath="url(#flag-pt-round)">
        <rect width="30" height="20" fill="#DA291C" />
        <rect width="12" height="20" fill="#046A38" />
        {/* Esfera armilar dourada centrada na divisão verde/vermelho */}
        <circle cx="12" cy="10" r="4.4" fill="#FFD34E" stroke="#9C6A00" strokeWidth="0.5" />
        <ellipse cx="12" cy="10" rx="4.4" ry="1.7" fill="none" stroke="#9C6A00" strokeWidth="0.4" />
        <line x1="12" y1="5.6" x2="12" y2="14.4" stroke="#9C6A00" strokeWidth="0.4" />
        {/* Escudo branco com contorno vermelho */}
        <rect x="10.3" y="7.4" width="3.4" height="4.4" rx="0.6" fill="#fff" stroke="#DA291C" strokeWidth="0.7" />
      </g>
      {/* Contorno subtil para definir a bandeira sobre fundos claros */}
      <rect width="30" height="20" rx="2.5" fill="none" stroke="rgba(0,0,0,0.12)" strokeWidth="1" />
    </svg>
  )
}

// Bandeira do Reino Unido (Union Jack), usada para o idioma inglês. A saltire
// (X) não é perfeitamente contra-trocada como a real — a esta escala isso não
// se nota e mantém o SVG simples.
export function FlagGB({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 30 20"
      className={cn('h-3.5 w-5 shrink-0 rounded-[3px]', className)}
      role="img"
      aria-hidden="true"
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <clipPath id="flag-gb-round">
          <rect width="30" height="20" rx="2.5" />
        </clipPath>
      </defs>
      <g clipPath="url(#flag-gb-round)">
        <rect width="30" height="20" fill="#012169" />
        {/* Saltire branca (St. Andrew) e depois vermelha (St. Patrick) */}
        <path d="M0,0 L30,20 M30,0 L0,20" stroke="#fff" strokeWidth="4" />
        <path d="M0,0 L30,20 M30,0 L0,20" stroke="#C8102E" strokeWidth="1.6" />
        {/* Cruz de St. George: branca por baixo, vermelha por cima */}
        <rect x="11" y="0" width="8" height="20" fill="#fff" />
        <rect x="0" y="6" width="30" height="8" fill="#fff" />
        <rect x="12.5" y="0" width="5" height="20" fill="#C8102E" />
        <rect x="0" y="7.5" width="30" height="5" fill="#C8102E" />
      </g>
      <rect width="30" height="20" rx="2.5" fill="none" stroke="rgba(0,0,0,0.12)" strokeWidth="1" />
    </svg>
  )
}

// Logótipo escrito ("Manage Eat") que mostra a versão certa conforme o tema:
// a CLARA (texto escuro) sobre fundo claro, a ESCURA (texto claro) sobre fundo
// escuro. Renderizamos as duas <img> e deixamos o CSS escolher qual aparece
// (`dark:` reage à classe .dark no <html>). Fazemos a troca por CSS, e não por
// JS, para não haver "flash" do logótipo errado no arranque — o tema já está
// decidido no primeiro paint (script inline no index.html), por isso a imagem
// certa aparece logo.
type WordmarkProps = {
  // Classes de tamanho/espaçamento aplicadas às duas imagens (ex.: "h-8 w-auto").
  className?: string
}

export function Wordmark({ className = '' }: WordmarkProps) {
  return (
    <>
      {/* Versão para fundo claro: visível no tema claro, escondida no escuro. */}
      <img
        src="/manage-eat-light.png"
        alt="Manage Eat"
        className={`block dark:hidden ${className}`}
      />
      {/* Versão para fundo escuro: escondida no claro, visível no escuro. A que
          estiver com display:none não é anunciada por leitores de ecrã, por isso
          o alt repetido não causa leitura dupla. */}
      <img
        src="/manage-eat-dark.png"
        alt="Manage Eat"
        className={`hidden dark:block ${className}`}
      />
    </>
  )
}

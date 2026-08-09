import { useState } from 'react'
import { X } from 'lucide-react'

interface Props {
  tags: string[]
  onChange: (tags: string[]) => void
  placeholder?: string
}

export function TagInput({ tags, onChange, placeholder = 'Enter para adicionar...' }: Props) {
  const [input, setInput] = useState('')

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const val = input.trim()
    if (val && !tags.includes(val)) onChange([...tags, val])
    setInput('')
  }

  return (
    <div className="flex flex-col gap-2">
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        aria-label="Introduzir nova tag"
        className="w-full bg-background border border-input rounded-lg px-4 py-2.5 focus:border-brand focus-visible:ring-[3px] focus-visible:ring-ring/50 transition-all placeholder:text-muted-foreground text-foreground text-sm outline-none"
      />
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <span
              key={tag}
              className="flex items-center gap-1 bg-secondary border border-border text-foreground text-xs px-2.5 py-1 rounded-full"
            >
              {tag}
              <button
                type="button"
                aria-label={`Remover tag ${tag}`}
                onClick={() => onChange(tags.filter((t) => t !== tag))}
                className="hover:bg-accent rounded-full p-0.5 transition-colors"
              >
                <X className="size-3 text-muted-foreground hover:text-foreground" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

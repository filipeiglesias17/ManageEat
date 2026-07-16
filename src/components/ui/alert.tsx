import type { ReactNode } from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

// Aviso inline reutilizável. Substitui os blocos coloridos ad-hoc que estavam
// copiados em várias páginas (bg-destructive/10 + border..., bg-yellow-50...).
// As cores vêm dos tokens de estado do index.css, por isso reagem ao tema sem
// precisar de dark: em cada uso.
const alertVariants = cva(
  "w-full rounded-lg border px-3 py-2.5 text-sm flex items-start gap-2.5",
  {
    variants: {
      variant: {
        info: "bg-info/10 border-info/25 text-info",
        success: "bg-success/10 border-success/25 text-success",
        warning: "bg-warning/10 border-warning/25 text-warning",
        destructive: "bg-destructive/10 border-destructive/25 text-destructive",
      },
    },
    defaultVariants: {
      variant: "info",
    },
  }
)

function Alert({
  className,
  variant = "info",
  icon,
  children,
  ...props
}: React.ComponentProps<"div"> &
  VariantProps<typeof alertVariants> & { icon?: ReactNode }) {
  // Erros e avisos interrompem (role=alert, lido de imediato pelos leitores de
  // ecrã); info/sucesso só informam (role=status, lido quando der).
  const role = variant === "destructive" || variant === "warning" ? "alert" : "status"

  return (
    <div
      role={role}
      data-slot="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    >
      {icon && <span className="shrink-0 mt-0.5 [&>svg]:size-4">{icon}</span>}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("font-semibold", className)} {...props} />
}

function AlertDescription({ className, ...props }: React.ComponentProps<"p">) {
  // Herda a cor da variante do Alert; o opacity baixa-a um nível (texto de apoio).
  return <p className={cn("text-[13px] opacity-90", className)} {...props} />
}

export { Alert, AlertTitle, AlertDescription }

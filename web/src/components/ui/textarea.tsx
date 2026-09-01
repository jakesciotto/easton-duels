import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "min-h-[160px] w-full resize-y rounded-md border border-input bg-card px-2.5 py-2 t3 text-foreground transition-[color,background-color,box-shadow] duration-150 ease-standard outline-none placeholder:text-gray-9 focus-visible:border-transparent focus-visible:shadow-focus focus-visible:outline-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }

import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

// Sizes follow 7.7's table (xs/sm/md/lg/mat); the cva keys keep their pre-brief
// names (default = md, icon = xs's 28-visual/44-hit treatment) because every
// call site in the app already types those keys.
const buttonVariants = cva(
  "group/button relative inline-flex shrink-0 items-center justify-center gap-2 rounded-md t3 font-medium! whitespace-nowrap transition-[color,background-color,border-color,box-shadow] duration-150 ease-standard outline-none select-none focus-visible:shadow-focus active:scale-[0.97] active:duration-120 active:ease-out disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-white text-black shadow-primary hover:bg-gray-12 active:bg-gray-11",
        secondary: "bg-gray-5 text-white shadow-ring hover:bg-gray-6 active:bg-gray-7",
        ghost: "text-gray-11 hover:bg-gray-3 hover:text-white active:bg-gray-4",
        destructive: "text-fault hover:bg-gray-3 active:bg-gray-4",
      },
      size: {
        default: "h-9 px-3.5",
        sm: "h-8 px-2.5",
        lg: "h-10 px-4",
        mat: "h-16 px-5",
        xs: "size-7 rounded-md p-0 before:absolute before:-inset-2 before:content-['']",
        icon: "size-7 rounded-md p-0 before:absolute before:-inset-2 before:content-['']",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }

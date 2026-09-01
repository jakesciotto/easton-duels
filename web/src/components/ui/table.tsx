import * as React from "react"

import { cn } from "@/lib/utils"

type Density = "compact" | "default"

// The head row always matches its body rung (2.7), so density is set once on
// the root and read by every row through context rather than repeated per row.
const DensityContext = React.createContext<Density>("compact")

const rowHeight: Record<Density, string> = {
  compact: "h-8",
  default: "h-10",
}

function Table({
  className,
  density = "compact",
  ...props
}: React.ComponentProps<"table"> & { density?: Density }) {
  return (
    <div className="overflow-x-auto">
      <DensityContext.Provider value={density}>
        <table
          data-slot="table"
          data-density={density}
          className={cn("w-full border-collapse t2 text-left", className)}
          {...props}
        />
      </DensityContext.Provider>
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("sticky top-0 z-10 bg-gray-1", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return <tbody data-slot="table-body" className={className} {...props} />
}

function TableRow({
  className,
  selected,
  ...props
}: React.ComponentProps<"tr"> & { selected?: boolean }) {
  const density = React.useContext(DensityContext)
  return (
    <tr
      data-slot="table-row"
      data-selected={selected || undefined}
      className={cn(
        rowHeight[density],
        "border-b border-gray-7 transition-colors duration-150 ease-standard last:border-0 hover:bg-gray-3 data-selected:bg-gray-4",
        className
      )}
      {...props}
    />
  )
}

// numeric marks the register tick (2.7) and switches the cell to the figure
// face; every numeric column head and its body cells must agree on this flag
// or the digits land off the track.
function TableHead({
  className,
  numeric,
  ...props
}: React.ComponentProps<"th"> & { numeric?: boolean }) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "px-3 align-middle t1 uppercase text-gray-10",
        numeric && "tick font-mono text-right",
        className
      )}
      {...props}
    />
  )
}

function TableCell({
  className,
  numeric,
  ...props
}: React.ComponentProps<"td"> & { numeric?: boolean }) {
  return (
    <td
      data-slot="table-cell"
      className={cn("px-3 align-middle", numeric && "fig text-right", className)}
      {...props}
    />
  )
}

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell }

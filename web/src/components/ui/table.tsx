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
  wrapperClassName,
  density = "compact",
  ...props
}: React.ComponentProps<"table"> & { density?: Density; wrapperClassName?: string }) {
  // 7.13 / finding 4: overflow-x-auto alone still computes overflow-y to auto (the
  // CSS rule that promotes a visible axis when the other is not visible), so this div
  // is a scroll container on both axes whether or not it ever actually scrolls
  // vertically. A caller that wraps the table in its OWN vertically scrolling box
  // therefore nests two scroll containers, and the sticky head sticks to this inner,
  // unconstrained one -- which has no scrolling room of its own -- instead of the
  // caller's. wrapperClassName lets the caller fold its vertical scroll (and any
  // max-height) into this single div instead of adding a second one around it.
  return (
    <div className={cn("overflow-x-auto", wrapperClassName)}>
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
//
// A numeric track is declared with `ch`, which resolves against the element's
// OWN font, so a head at `t1` and a body cell at `t2` resolve the identical
// `var(--col-num-*)` to two different pixel widths (2.7's resolved-widths
// table: t1 col-num-m is 43.8px, t2 is 47.4px) and the browser's table auto
// layout then gives the column whichever is larger, stranding the register
// tick off the digits it marks (finding 3). So a numeric head is pinned to
// `t2`, the body's own step, instead of the general `t1` column-head size;
// callers that want the visible label smaller wrap it in its own `t1` span,
// same as the roster and candidate row heads already do.
function TableHead({
  className,
  numeric,
  ...props
}: React.ComponentProps<"th"> & { numeric?: boolean }) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "px-3 align-middle uppercase text-gray-10",
        numeric ? "tick t2 font-mono text-right" : "t1",
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

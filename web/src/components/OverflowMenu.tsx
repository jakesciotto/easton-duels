import { Ellipsis } from 'lucide-react'
import { Menu } from '@base-ui/react/menu'

import { cn } from '@/lib/utils'
import { buttonVariants } from '@/components/ui/button'

export interface MenuItemSpec {
  key: string
  label: string
  disabled: boolean
  onSelect: () => void
  /** 7.7: a destructive item carries its consequence in the text colour, never a fill. */
  tone?: 'destructive'
}

/**
 * 6.9: the face of a panel or a row holds the one action that matters and this holds the
 * rare ones, instead of a row of identical grey text links. Lifted out of the Live tab
 * once the Matches tab needed the same control on its settled rows, so the two screens
 * cannot drift into two shapes for one job.
 */
export function OverflowMenu({ label, text, disabled = false, items, className }: {
  /** The accessible name, which names the row as well as the action. */
  label: string
  /**
   * Visible text instead of the ellipsis, for a menu that is one named action with a
   * choice inside it rather than a row's rare actions. `label` still names the row, and
   * it opens with this text so the visible label is part of the accessible name.
   */
  text?: string
  disabled?: boolean
  items: MenuItemSpec[]
  className?: string
}) {
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={label}
        disabled={disabled}
        className={buttonVariants({ variant: 'ghost', size: text === undefined ? 'xs' : 'sm', className: cn('self-center', className) })}
      >
        {text ?? <Ellipsis />}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="end" sideOffset={4} className="isolate z-50">
          <Menu.Popup className="min-w-48 origin-(--transform-origin) rounded-xl border border-border bg-popover p-1 shadow-dialog">
            {items.map(item => (
              <Menu.Item
                key={item.key}
                disabled={item.disabled}
                onClick={item.onSelect}
                className={cn(
                  'flex cursor-default items-center rounded-md px-2.5 py-1.5 t3 outline-none select-none data-disabled:opacity-50 data-highlighted:bg-gray-4',
                  item.tone === 'destructive' ? 'text-fault' : 'text-gray-11 data-highlighted:text-white',
                )}
              >
                {item.label}
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}

import { ColourOrb } from '@/components/ColourOrb'

export function TeamDot({ color, name }: { color: string; name?: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <ColourOrb color={color} size={12} />
      {name && <span>{name}</span>}
    </span>
  )
}

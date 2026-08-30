export function Connecting({ connected }: { connected: boolean }) {
  if (connected) return null
  return (
    <div role="status" className="shrink-0 border-b border-warn/35 bg-warn/10 py-1 text-center text-sm font-medium text-warn">
      Reconnecting to the server
    </div>
  )
}

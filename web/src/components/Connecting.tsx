export function Connecting({ connected }: { connected: boolean }) {
  if (connected) return null
  return (
    <div role="status" className="fixed inset-x-0 top-0 z-50 bg-warn py-1 text-center text-sm font-semibold text-background">
      Reconnecting to the server
    </div>
  )
}

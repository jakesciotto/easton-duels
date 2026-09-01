// 6.4: "the banner gets ONE fixed placement everywhere." Fixed to the viewport rather than
// laid out inline lets every caller mount it wherever is convenient in its own tree and
// still have it land in the same physical spot.
export function Connecting({ connected }: { connected: boolean }) {
  if (connected) return null
  return (
    <div
      role="status"
      className="fixed inset-x-0 top-0 z-40 border-b border-gray-7 bg-gray-2 py-1.5 text-center t2 text-fault"
    >
      Reconnecting to the server
    </div>
  )
}

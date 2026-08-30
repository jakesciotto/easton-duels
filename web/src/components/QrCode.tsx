import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

export function QrCode({ text, size = 240 }: { text: string; size?: number }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let ignore = false
    QRCode.toDataURL(text, { margin: 1, width: size }).then(url => { if (!ignore) setSrc(url) }).catch(() => { if (!ignore) setSrc(null) })
    return () => { ignore = true }
  }, [text, size])
  if (!src) return <div style={{ width: size, height: size }} className="rounded-lg bg-muted" aria-hidden />
  return <img src={src} width={size} height={size} alt="QR code" className="rounded-lg bg-white p-3" />
}

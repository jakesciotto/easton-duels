import { useParams } from 'react-router'
import { useSnapshot } from '@/lib/useSnapshot'
import { Board } from './board/Board'

export default function BoardPage() {
  const { eventId } = useParams()
  const { snapshot, connected } = useSnapshot(eventId ? Number(eventId) : null)
  return <Board snapshot={snapshot} connected={connected} />
}

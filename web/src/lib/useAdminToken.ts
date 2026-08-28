import { useSyncExternalStore } from 'react'
import { getAdminToken, subscribeAdminToken } from './auth'

export function useAdminToken(): string | null {
  return useSyncExternalStore(subscribeAdminToken, getAdminToken, () => null)
}

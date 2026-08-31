export interface WlLocation { kBusiness: string; title: string; city: string }

export interface WlBeltRecord {
  uid: string
  kBusiness: string
  location: string
  firstName: string
  lastName: string
  rankTitle: string
  categoryTitle: string
  promotedAt: string | null
}

export interface WlLike {
  listLocations(): Promise<WlLocation[]>
  fetchKidsBeltRecords(kBusiness: string, location: string, deadlineMs?: number): Promise<WlBeltRecord[]>
}

export interface LeaderboardConfig { url: string; key: string }

export interface LeaderboardCompetitor {
  id: string
  name: string
  belt: string | null
  ageGroup: string | null
  gender: string | null
  weightClass: string | null
  academy: string | null
  erp: number | null
}

export interface RosterCandidate {
  wlUid: string
  firstName: string
  lastName: string
  belt: string | null
  wlLocation: string
  leaderboardId: string | null
  erp: number | null
  age: number | null
  weightLbs: number | null
  gender: string | null
}

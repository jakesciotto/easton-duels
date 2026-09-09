import type { SyncReport } from '@/lib/types'

/**
 * Spec 7.2, in one place because two screens print it. The sync dialog reads the report
 * the pull came back with and the Roster tab reads the same report once the dialog
 * closes, and a competitor an organizer has to deal with by hand must be named the same
 * way in both.
 *
 * The count line always prints, so a run that linked nothing still says so. Every other
 * line names people, and a line naming nobody would be noise.
 */
export function reportLines(report: SyncReport): string[] {
  const lines = [`Linked ${report.linked.length}. Refreshed ${report.refreshed}, ${report.changed.length} changed.`]
  for (const s of report.suggested) lines.push(`To confirm: ${s.name} looks like ${s.candidate}, ${s.location}.`)
  if (report.ambiguous.length > 0) lines.push(`Two candidates, link by hand: ${report.ambiguous.join(', ')}.`)
  if (report.unmatched.length > 0) lines.push(`Not found: ${report.unmatched.join(', ')}.`)
  if (report.gone.length > 0) lines.push(`Gone from WellnessLiving: ${report.gone.join(', ')}.`)
  return lines
}

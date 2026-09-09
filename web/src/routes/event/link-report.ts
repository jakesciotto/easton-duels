import type { MatchReport } from '@/lib/types'

/**
 * Spec 5.3, in one place because two screens print it. The import dialog reads the report
 * the pull came back with and the Roster tab reads the report its own Match button came
 * back with, and a competitor an organizer has to deal with by hand must be named the same
 * way in both.
 *
 * The count line always prints, so a run that linked nothing still says so. Every other
 * line names people, and a line naming nobody would be noise.
 */
export function reportLines(report: MatchReport): string[] {
  const n = report.matched.length
  const lines = [`Matched ${n} pasted ${n === 1 ? 'competitor' : 'competitors'} to WellnessLiving.`]
  if (report.unmatched.length > 0) lines.push(`Not found: ${report.unmatched.join(', ')}.`)
  if (report.ambiguous.length > 0) lines.push(`Two candidates, link by hand: ${report.ambiguous.join(', ')}.`)
  if (report.duplicates.length > 0) lines.push(`Already on the roster: ${report.duplicates.join(', ')}.`)
  return lines
}

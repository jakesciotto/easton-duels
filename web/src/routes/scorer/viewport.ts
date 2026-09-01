import { useEffect, useState } from 'react'
import { SHORTEST_VIEWPORT } from './budget'

/**
 * 6.16: the scorer is locked to landscape at 900 CSS px or wider. At a phone's density a
 * 20mm gloved target is 120 CSS px and a half screen is about 196, so a three up action
 * grid is geometrically impossible and the honest answer is a plain page.
 *
 * Measured rather than asked of matchMedia: the same two numbers decide it in a browser
 * and under test, and orientation is width against height rather than a media feature
 * that a desktop window cannot express.
 */
export const MIN_SCORER_WIDTH = 900

export function fitsScorer(width: number, height: number): boolean {
  return width >= MIN_SCORER_WIDTH && width >= height
}

export function useFitsScorer(): boolean {
  const [fits, setFits] = useState(() => typeof window === 'undefined' || fitsScorer(window.innerWidth, window.innerHeight))
  useEffect(() => {
    const read = () => setFits(fitsScorer(window.innerWidth, window.innerHeight))
    read()
    window.addEventListener('resize', read)
    window.addEventListener('orientationchange', read)
    return () => {
      window.removeEventListener('resize', read)
      window.removeEventListener('orientationchange', read)
    }
  }, [])
  return fits
}

/**
 * The LAYOUT viewport's height, which is what `h-dvh` on the scorer shell resolves to and
 * what the centre column actually gets. On iPadOS Safari it is already the screen height
 * minus the browser's chrome; `screen.height` is the number that made budget.ts wrong.
 */
export function viewportHeight(): number {
  return window.innerHeight
}

/**
 * Read once and on a real resize or rotation, never per render, so the column's shape is a
 * fact about the tablet rather than something that moves under the operator's thumb. The
 * server default is the worst case, because a column budgeted short is one that fits.
 */
export function useViewportHeight(): number {
  const [height, setHeight] = useState(() =>
    typeof window === 'undefined' ? SHORTEST_VIEWPORT : viewportHeight())
  useEffect(() => {
    const read = () => setHeight(viewportHeight())
    read()
    window.addEventListener('resize', read)
    window.addEventListener('orientationchange', read)
    return () => {
      window.removeEventListener('resize', read)
      window.removeEventListener('orientationchange', read)
    }
  }, [])
  return height
}

import { describe, it, expect } from 'vitest'
import { weightClass, classGap } from '../src/shared/weight-class.js'

describe('weightClass', () => {
  it('puts every band edge on the right side of the line', () => {
    const edges: [number, number][] = [
      [39, 0], [40, 1], [46, 1], [47, 2], [53, 2], [54, 3], [61, 3], [62, 4], [70, 4],
      [71, 5], [80, 5], [81, 6], [90, 6], [91, 7], [100, 7], [101, 8], [110, 8], [111, 9], [120, 9],
    ]
    for (const [lbs, index] of edges) expect(weightClass(lbs).index, `${lbs} lbs`).toBe(index)
  })

  it('names each band the way the registration prints it', () => {
    expect(weightClass(38).label).toBe('Up to 39 lbs')
    expect(weightClass(40).label).toBe('40 to 46 lbs')
    expect(weightClass(50).label).toBe('47 to 53 lbs')
    expect(weightClass(58).label).toBe('54 to 61 lbs')
    expect(weightClass(65).label).toBe('62 to 70 lbs')
    expect(weightClass(75).label).toBe('71 to 80 lbs')
    expect(weightClass(85).label).toBe('81 to 90 lbs')
    expect(weightClass(95).label).toBe('91 to 100 lbs')
    expect(weightClass(105).label).toBe('101 to 110 lbs')
    expect(weightClass(115).label).toBe('111 to 120 lbs')
  })

  it('carries on in tens above 120', () => {
    expect(weightClass(121)).toEqual({ index: 10, label: '121 to 130 lbs' })
    expect(weightClass(130)).toEqual({ index: 10, label: '121 to 130 lbs' })
    expect(weightClass(131)).toEqual({ index: 11, label: '131 to 140 lbs' })
    expect(weightClass(140)).toEqual({ index: 11, label: '131 to 140 lbs' })
    expect(weightClass(201)).toEqual({ index: 18, label: '201 to 210 lbs' })
  })

  it('rounds to the pound before it reads the band', () => {
    expect(weightClass(52.6)).toEqual({ index: 2, label: '47 to 53 lbs' })
    expect(weightClass(46.5).index).toBe(2)
    expect(weightClass(46.4).index).toBe(1)
    expect(weightClass(120.49).index).toBe(9)
    expect(weightClass(120.5).index).toBe(10)
  })

  it('reads a weight under the first band as the first band', () => {
    expect(weightClass(0)).toEqual({ index: 0, label: 'Up to 39 lbs' })
  })
})

describe('classGap', () => {
  it('counts the bands between two weights, either way round', () => {
    expect(classGap(62, 70)).toBe(0)
    expect(classGap(60, 62)).toBe(1)
    expect(classGap(62, 60)).toBe(1)
    expect(classGap(39, 120)).toBe(9)
    expect(classGap(115, 131)).toBe(2)
  })
})

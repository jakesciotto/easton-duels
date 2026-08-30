import { describe, it, expect } from 'vitest'
import { moveId } from '@/lib/reorder'

describe('moveId', () => {
  it('moves an id to a new index and leaves the rest in order', () => {
    expect(moveId([1, 2, 3, 4], 0, 2)).toEqual([2, 3, 1, 4])
    expect(moveId([1, 2, 3, 4], 3, 0)).toEqual([4, 1, 2, 3])
    expect(moveId([1, 2, 3], 1, 1)).toEqual([1, 2, 3])
  })
})

import { describe, it, expect } from 'vitest'
import { kidsQuery, searchQuery } from '../src/roster/belts.js'
import type { WlNameFilter } from '../src/roster/types.js'

const filter = (o: Partial<WlNameFilter>): WlNameFilter => ({ uids: [], lastTokens: [], firstTokens: [], ...o })

describe('searchQuery', () => {
  it('appends one parenthesised or clause to the kids query', () => {
    const queries = searchQuery(filter({ uids: ['u1', 'u2'], lastTokens: ['rivera'], firstTokens: ['mateo'] }))
    expect(queries).toEqual([
      `${kidsQuery()} and (uid in ('u1','u2') or \`o_client.text_last\` like '%rivera%' or \`o_client.text_first\` like '%mateo%')`,
    ])
  })

  it('names every where column exactly as the projection does, in backticks', () => {
    const [q] = searchQuery(filter({ lastTokens: ['rivera'], firstTokens: ['mateo'] }))
    for (const column of ['`o_client.text_last`', '`o_client.text_first`']) {
      expect(kidsQuery()).toContain(column)
      expect(q).toContain(`${column} like`)
    }
  })

  it('doubles a quote in a uid and in a token', () => {
    const [q] = searchQuery(filter({ uids: ["o'neil"], lastTokens: ["d'angelo"] }))
    expect(q).toContain("uid in ('o''neil')")
    expect(q).toContain("`o_client.text_last` like '%d''angelo%'")
  })

  it('answers no query at all for an empty filter', () => {
    expect(searchQuery(filter({}))).toEqual([])
  })

  it('splits more than sixty terms into a query each', () => {
    const lastTokens = Array.from({ length: 61 }, (_, i) => `token${i}`)
    const queries = searchQuery(filter({ lastTokens }))
    expect(queries).toHaveLength(2)
    expect(queries[0].match(/like '%token/g)).toHaveLength(60)
    expect(queries[1]).toBe(`${kidsQuery()} and (\`o_client.text_last\` like '%token60%')`)
  })

  it('counts a uid as a term, and gives each batch its own uid list', () => {
    const uids = Array.from({ length: 59 }, (_, i) => `u${i}`)
    const queries = searchQuery(filter({ uids, lastTokens: ['rivera', 'martin'] }))
    expect(queries).toHaveLength(2)
    expect(queries[0]).toContain("like '%rivera%'")
    expect(queries[0]).not.toContain("like '%martin%'")
    expect(queries[1]).toBe(`${kidsQuery()} and (\`o_client.text_last\` like '%martin%')`)
  })

  it('threads an exact category title through the query, escaping its quote', () => {
    const [q] = searchQuery(filter({ uids: ['u1'] }), "O'Brien Kids Belts")
    expect(q).toContain("text_rank_category = 'O''Brien Kids Belts'")
    expect(q).toContain("uid in ('u1')")
  })
})

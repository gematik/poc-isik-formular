import { describe, it, expect } from 'vitest'
import { __test__ as R } from '../src/resolve.js'

describe('resolve helpers', () => {
  it('makeAbs joins base and path', () => {
    expect(R.makeAbs('https://a/fhir', 'Patient/1')).toBe('https://a/fhir/Patient/1')
    expect(R.makeAbs('https://a/fhir/', '/Patient/1')).toBe('https://a/fhir/Patient/1')
  })

  it('bundleEntries flattens Bundle.entry', () => {
    const b = { resourceType: 'Bundle', entry: [{ resource: { a: 1 } }, { resource: { b: 2 } }] }
    expect(R.bundleEntries(b)).toEqual([{ a: 1 }, { b: 2 }])
  })

  it('mdToHtml renders basic markdown safely', () => {
    const html = R.mdToHtml('Hello **bold** [x](http://x) and `code`')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('<a href="http://x"')
    expect(html).toContain('<code>code</code>')
  })

  it('getAccountTitle and accountDetails', () => {
    expect(R.getAccountTitle({ name: 'A' })).toBe('A')
    const keys = R.accountDetails({ id: '1', status: 'active' }).map(r => r[0])
    expect(keys).toContain('ID')
    expect(keys).toContain('Status')
  })
})


import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as M from '../src/lib/helpers.js'

describe('main helpers', () => {
  it('encodeForQueryPreservingSpecials keeps :/| and encodes & ?', () => {
    const s = 'http://x/y?z=1&k=2|v'
    const out = M.encodeForQueryPreservingSpecials(s)
    expect(out).toContain('http://x/y')
    expect(out).toContain('|')
    expect(out).not.toContain('&')
    expect(out).toContain('%3F') // ? encoded
  })

  it('collectModifierExtensionUrls finds nested modifierExtension urls', () => {
    const q = { item: [{ modifierExtension: [{ url: 'u:a' }] }, { item: [{ modifierExtension: [{ url: 'u:b' }] }] }] }
    const set = M.collectModifierExtensionUrls(q)
    expect(Array.from(set)).toEqual(['u:a', 'u:b'])
  })

  it('getEffectivePrepopBase prefers prepopBase over fhirBase', () => {
    expect(M.getEffectivePrepopBase({ prepopBase: 'A', fhirBase: 'B' })).toBe('A')
    expect(M.getEffectivePrepopBase({ prepopBase: '', fhirBase: 'B' })).toBe('B')
    expect(M.getEffectivePrepopBase({})).toBe(null)
  })

  describe('createFhirClient', () => {
    beforeEach(() => {
      vi.restoreAllMocks()
    })

    it('builds absolute URLs and sets Accept header', async () => {
      const fetchMock = vi.fn(async (url, opts) => ({ ok: true, json: async () => ({ url, opts }) }))
      globalThis.fetch = fetchMock
      const c = M.createFhirClient('https://ex/fhir')
      const res = await c.request('Patient/123')
      expect(fetchMock).toHaveBeenCalled()
      expect(res.url).toBe('https://ex/fhir/Patient/123')
      expect(res.opts.headers['Accept']).toBe('application/fhir+json')
    })

    it('patient.request adds patient filter when ids.patient is set', async () => {
      const fetchMock = vi.fn(async (url, opts) => ({ ok: true, json: async () => ({ url }) }))
      globalThis.fetch = fetchMock
      const c = M.createFhirClient('https://ex/fhir', { patient: 'p1' })
      const res = await c.patient.request('Observation?code=1234-5')
      expect(res.url).toMatch(/patient=p1/)
    })
  })

  it('getPatientName builds display name', () => {
    const p = { name: [{ given: ['Max'], family: 'Mustermann' }] }
    expect(M.getPatientName(p)).toContain('Max')
    expect(M.getPatientName(p)).toContain('Mustermann')
  })

  it('patientDetails returns key-value rows', () => {
    const rows = M.patientDetails({ id: '1', gender: 'male' })
    const keys = rows.map(r => r[0])
    expect(keys).toContain('ID')
    expect(keys).toContain('Geschlecht')
  })

  it('questionnaireDetails returns expected fields', () => {
    const rows = M.questionnaireDetails({ id: 'q', version: 'v1', url: 'u' })
    const keys = rows.map(r => r[0])
    expect(keys).toEqual(['ID', 'Version', 'URL'])
  })
})

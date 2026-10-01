import { describe, it, expect } from 'vitest'
import { WHATSAPP_FLOWS, FLOW_KEYS, isFlowEnabled, isKnownFlow, getFlow } from '../whatsappFlows'

describe('WHATSAPP_FLOWS registry', () => {
  it('lists the seven send flows in a fixed order', () => {
    expect(FLOW_KEYS).toEqual([
      'examResults', 'late', 'lectureMiss', 'examAbsence', 'homework', 'mentorNudge', 'hostelAlert',
    ])
  })

  // Pinned on purpose: this set must equal the env vars the endpoints read. A new
  // send flow that is not added here would have no switch and no Settings row.
  it('names exactly the template env vars the endpoints read', () => {
    expect(WHATSAPP_FLOWS.map(f => f.envVar).sort()).toEqual([
      'WABRIDGE_EXAM_ABSENCE_TEMPLATE_ID',
      'WABRIDGE_HOMEWORK_TEMPLATE_ID',
      'WABRIDGE_HOSTEL_ALERT_TEMPLATE_ID',
      'WABRIDGE_LATE_TEMPLATE_ID',
      'WABRIDGE_LECTURE_MISS_TEMPLATE_ID',
      'WABRIDGE_MENTOR_NUDGE_TEMPLATE_ID',
      'WABRIDGE_TEMPLATE_ID',
    ])
  })

  it('has unique keys and every field the Settings card renders', () => {
    expect(new Set(FLOW_KEYS).size).toBe(FLOW_KEYS.length)
    for (const f of WHATSAPP_FLOWS) {
      expect(f.label).toBeTruthy()
      expect(f.description).toBeTruthy()
      expect(f.recipients).toBeTruthy()
      expect(f.trigger).toBeTruthy()
      expect(f.endpoint).toMatch(/^api\/send-[a-z-]+\.js$/)
      expect(Array.isArray(f.variables) && f.variables.length > 0).toBe(true)
    }
  })

  it('marks only the mentorship nudge as running on a live cron', () => {
    expect(WHATSAPP_FLOWS.filter(f => f.cron === 'live').map(f => f.key)).toEqual(['mentorNudge'])
    expect(getFlow('hostelAlert').cron).toBe('ready')
  })
})

describe('isFlowEnabled', () => {
  it('treats an absent map as everything on', () => {
    expect(isFlowEnabled(undefined, 'late')).toBe(true)
    expect(isFlowEnabled(null, 'late')).toBe(true)
    expect(isFlowEnabled({}, 'late')).toBe(true)
  })

  it('is off only for an explicit enabled:false', () => {
    expect(isFlowEnabled({ late: { enabled: false } }, 'late')).toBe(false)
    expect(isFlowEnabled({ late: { enabled: true } }, 'late')).toBe(true)
    expect(isFlowEnabled({ late: {} }, 'late')).toBe(true)
    expect(isFlowEnabled({ late: { enabled: 0 } }, 'late')).toBe(true)
  })

  it('does not let one flow switch another', () => {
    expect(isFlowEnabled({ late: { enabled: false } }, 'homework')).toBe(true)
  })
})

describe('isKnownFlow', () => {
  it('accepts registry keys and rejects anything else', () => {
    expect(isKnownFlow('mentorNudge')).toBe(true)
    expect(isKnownFlow('schedule')).toBe(false)
    expect(isKnownFlow(undefined)).toBe(false)
  })
})

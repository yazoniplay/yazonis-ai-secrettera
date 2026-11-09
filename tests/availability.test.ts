import { describe, expect, it } from 'vitest';
import { evaluateAvailability } from '../src/availability.js';

describe('evaluateAvailability', () => {
  it('allows a recently confirmed status before 18:00 Stockholm time', () => {
    const result = evaluateAvailability({
      manualStatus: 'available',
      lastConfirmedAt: '2026-11-09T14:55:00.000Z',
      lastSeenAt: '2026-11-09T14:59:30.000Z',
      now: new Date('2026-11-09T15:00:00.000Z')
    });
    expect(result.available).toBe(true);
    expect(result.status).toBe('available');
  });

  it('blocks availability at 18:00 Stockholm time', () => {
    const result = evaluateAvailability({
      manualStatus: 'available',
      lastConfirmedAt: '2026-11-09T16:59:00.000Z',
      now: new Date('2026-11-09T17:00:00.000Z')
    });
    expect(result.available).toBe(false);
    expect(result.status).toBe('after_hours');
  });

  it('expires confirmation at 10 minutes', () => {
    const result = evaluateAvailability({
      manualStatus: 'available',
      lastConfirmedAt: '2026-11-09T15:00:00.000Z',
      lastSeenAt: '2026-11-09T15:09:30.000Z',
      now: new Date('2026-11-09T15:10:00.000Z')
    });
    expect(result.available).toBe(false);
    expect(result.status).toBe('confirmation_expired');
  });

  it('does not allow busy status to receive calls', () => {
    const result = evaluateAvailability({
      manualStatus: 'busy',
      lastConfirmedAt: '2026-11-09T15:05:00.000Z',
      now: new Date('2026-11-09T15:06:00.000Z')
    });
    expect(result.available).toBe(false);
    expect(result.status).toBe('busy');
  });

  it('does not allow a confirmation timestamp from the future', () => {
    const result = evaluateAvailability({
      manualStatus: 'available',
      lastConfirmedAt: '2026-11-09T15:05:00.000Z',
      lastSeenAt: '2026-11-09T15:00:00.000Z',
      now: new Date('2026-11-09T15:00:00.000Z')
    });
    expect(result.available).toBe(false);
  });
  it('marks the owner offline when the phone heartbeat becomes stale', () => {
    const result = evaluateAvailability({
      manualStatus: 'available',
      lastConfirmedAt: '2026-11-09T14:59:00.000Z',
      lastSeenAt: '2026-11-09T14:58:00.000Z',
      now: new Date('2026-11-09T15:00:00.000Z')
    });
    expect(result.available).toBe(false);
    expect(result.status).toBe('offline');
  });

  it('keeps a recently seen owner online before the presence timeout', () => {
    const result = evaluateAvailability({
      manualStatus: 'available',
      lastConfirmedAt: '2026-11-09T14:59:00.000Z',
      lastSeenAt: '2026-11-09T14:59:30.000Z',
      now: new Date('2026-11-09T15:00:00.000Z')
    });
    expect(result.available).toBe(true);
  });

});

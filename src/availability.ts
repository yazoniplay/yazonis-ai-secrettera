import { DateTime } from 'luxon';

export const TIME_ZONE = 'Europe/Stockholm';
export const CONFIRMATION_TTL_MINUTES = 10;
export const CUTOFF_HOUR = 18;

export type ManualStatus = 'available' | 'busy' | 'unavailable';
export type EffectiveStatus = ManualStatus | 'after_hours' | 'confirmation_expired';

export interface AvailabilityInput {
  manualStatus: ManualStatus;
  lastConfirmedAt: string | null;
  now?: Date;
}

export interface AvailabilityResult {
  status: EffectiveStatus;
  available: boolean;
  reason: string;
  localTime: string;
  lastConfirmedAt: string | null;
  confirmationExpiresAt: string | null;
}

export function evaluateAvailability(input: AvailabilityInput): AvailabilityResult {
  const now = DateTime.fromJSDate(input.now ?? new Date(), { zone: 'utc' });
  const local = now.setZone(TIME_ZONE);

  if (local.hour >= CUTOFF_HOUR) {
    return {
      status: 'after_hours',
      available: false,
      reason: 'Outside calling hours (after 18:00 Europe/Stockholm).',
      localTime: local.toISO() ?? '',
      lastConfirmedAt: input.lastConfirmedAt,
      confirmationExpiresAt: null
    };
  }

  if (input.manualStatus !== 'available') {
    return {
      status: input.manualStatus,
      available: false,
      reason: input.manualStatus === 'busy' ? 'Manually marked busy.' : 'Manually marked unavailable.',
      localTime: local.toISO() ?? '',
      lastConfirmedAt: input.lastConfirmedAt,
      confirmationExpiresAt: null
    };
  }

  if (!input.lastConfirmedAt) {
    return {
      status: 'confirmation_expired',
      available: false,
      reason: 'Availability has not been confirmed.',
      localTime: local.toISO() ?? '',
      lastConfirmedAt: null,
      confirmationExpiresAt: null
    };
  }

  const confirmed = DateTime.fromISO(input.lastConfirmedAt, { setZone: true });
  const ageMinutes = confirmed.isValid ? now.diff(confirmed, 'minutes').minutes : Infinity;
  if (!confirmed.isValid || ageMinutes < 0 || ageMinutes >= CONFIRMATION_TTL_MINUTES) {
    return {
      status: 'confirmation_expired',
      available: false,
      reason: 'Availability confirmation expired after 10 minutes.',
      localTime: local.toISO() ?? '',
      lastConfirmedAt: input.lastConfirmedAt,
      confirmationExpiresAt: confirmed.isValid ? confirmed.plus({ minutes: CONFIRMATION_TTL_MINUTES }).toISO() : null
    };
  }

  return {
    status: 'available',
    available: true,
    reason: 'Availability recently confirmed.',
    localTime: local.toISO() ?? '',
    lastConfirmedAt: input.lastConfirmedAt,
    confirmationExpiresAt: confirmed.plus({ minutes: CONFIRMATION_TTL_MINUTES }).toISO()
  };
}

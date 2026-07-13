import { THRESHOLDS } from './config.js';

// Minutes elapsed since an ISO timestamp, clamped so clock skew between the
// server and the display can never produce a negative time.
export function minutesSince(iso, nowMs) {
  if (!iso) return null;
  return Math.max(0, (nowMs - new Date(iso).getTime()) / 60000);
}

export function formatElapsed(iso, nowMs) {
  const mins = minutesSince(iso, nowMs);
  if (mins == null) return '—';
  const totalSec = Math.floor(mins * 60);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// green while on time, amber past warnMinutes, red past alertMinutes
export function elapsedTone(iso, nowMs) {
  const mins = minutesSince(iso, nowMs);
  if (mins == null) return 'ok';
  if (mins >= THRESHOLDS.alertMinutes) return 'alert';
  if (mins >= THRESHOLDS.warnMinutes) return 'warn';
  return 'ok';
}

export function formatClock(dateLike) {
  return new Date(dateLike).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function displayName(p) {
  if (!p?.first_name) return '';
  return `${p.first_name} ${p.last_initial}.`;
}

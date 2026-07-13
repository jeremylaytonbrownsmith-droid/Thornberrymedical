// Board thresholds — tune these to the practice's tolerance.
// Applies to both time-in-room and time-in-waiting-room.
export const THRESHOLDS = {
  warnMinutes: 10, // elapsed time turns amber
  alertMinutes: 20, // elapsed time turns red
};

export const POLL_INTERVAL_MS = 3000;

export const FLAG_META = {
  patient_waiting: { label: 'Patient waiting', tone: 'warn' },
  needs_assistance: { label: 'Needs assistance', tone: 'alert' },
  needs_supplies: { label: 'Needs supplies', tone: 'warn' },
  needs_injection: { label: 'Needs injection', tone: 'info' },
  needs_xray: { label: 'Needs X-ray', tone: 'info' },
  wound_care: { label: 'Wound care', tone: 'warn' },
  procedure_setup: { label: 'Procedure setup', tone: 'warn' },
  boot_fitting: { label: 'Boot fitting', tone: 'info' },
  needs_casting: { label: 'Orthotics casting', tone: 'info' },
  ready_for_provider: { label: 'Ready for provider', tone: 'info' },
  checkout_ready: { label: 'Checkout ready', tone: 'ok' },
};

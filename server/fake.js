// Synthetic-data generators. Names, phones, and DOBs are invented from pools —
// nothing here comes from, or should ever come from, a real data source.

const FIRST_NAMES = [
  'Ava', 'Ben', 'Clara', 'Dev', 'Elena', 'Felix', 'Grace', 'Hugo', 'Iris',
  'Jonah', 'Kai', 'Lena', 'Marco', 'Nadia', 'Oscar', 'Priya', 'Quinn',
  'Rosa', 'Sam', 'Tessa', 'Umar', 'Vera', 'Wes', 'Ximena', 'Yusuf', 'Zoe',
];

const LAST_INITIALS = 'ABCDEFGHJKLMNPRSTVW'.split('');

const VISIT_REASONS = [
  'Annual checkup', 'Ankle follow-up', 'Blood pressure check', 'Flu symptoms',
  'Knee pain', 'Lab results review', 'Medication refill', 'Migraine consult',
  'Physical for work', 'Rash evaluation', 'Shoulder strain', 'Sinus infection',
  'Sports physical', 'Vaccination', 'Wellness visit', 'Back pain follow-up',
];

const PROVIDERS = ['Dr. Ashford', 'Dr. Ibarra', 'Dr. Okafor', 'PA Whitfield'];

export const ROOM_NAMES = ['Exam 1', 'Exam 2', 'Exam 3', 'Exam 4', 'Exam 5', 'Exam 6'];

export const REQUEST_TYPES = [
  'patient_waiting',
  'needs_assistance',
  'needs_supplies',
  'ready_for_provider',
  'checkout_ready',
];

export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const randInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

export function fakePatient() {
  const year = randInt(1945, 2007);
  const month = String(randInt(1, 12)).padStart(2, '0');
  const day = String(randInt(1, 28)).padStart(2, '0');
  return {
    first_name: pick(FIRST_NAMES),
    last_initial: pick(LAST_INITIALS),
    date_of_birth: `${year}-${month}-${day}`,
    reason_for_visit: pick(VISIT_REASONS),
    // Explicitly non-dialable fake exchange (555-01xx is reserved for fiction)
    phone: `(555) 01${randInt(0, 9)}-${String(randInt(0, 9999)).padStart(4, '0')}`,
  };
}

export function fakeProvider() {
  return pick(PROVIDERS);
}

// The portal's date-range buttons (All Time / Last Month / Last Week / This
// Week) as a first day to include, in UTC, matching portal.js's
// portalRangeCutoff so the page and the API never disagree about a range.

export const RANGES = ['all', 'last-month', 'last-week', 'this-week'];

export function rangeCutoff(range, now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (range === 'last-month') d.setUTCDate(d.getUTCDate() - 30);
  else if (range === 'last-week') d.setUTCDate(d.getUTCDate() - 7);
  else if (range === 'this-week') d.setUTCDate(d.getUTCDate() - d.getUTCDay() + (d.getUTCDay() === 0 ? -6 : 1)); // most recent Monday
  else return null; // "all"
  return d.toISOString().slice(0, 10);
}

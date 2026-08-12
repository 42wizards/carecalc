/**
 * calculateCostWithValidation(shifts)
 * - shifts: array of { start: ISOString | Date, end: ISOString | Date }
 * Returns:
 * - If invalid: { valid: false, errors: [ ... ] }
 * - If valid: { valid: true, total: number, breakdown: [ { start, end, hours, rate, base, overnightDiff, weekendDiff, amount } ] }
 *
 * Rules added:
 * - Each shift must be >= 4 hours
 * - Start minute must be 0,15,30,45 (quarter-hour)
 * - Duration must be integer hours (1-hour increments)
 * - Weekly minimum: total hours across provided shifts must be >= 20
 *
 * Existing rules:
 * - baseRate = 37.00
 * - overnightDiff = 4.00 applied outside 06:00–22:00
 * - weekendDiff = 4.00 applied for Saturday & Sunday
 * - diffs stack
 */

function parseDate(input) {
  return (input instanceof Date) ? new Date(input) : new Date(input);
}

function clampRange(a, b, x, y) {
  const start = new Date(Math.max(a.getTime(), x.getTime()));
  const end = new Date(Math.min(b.getTime(), y.getTime()));
  if (end <= start) return null;
  return { start, end };
}

function hoursBetween(a, b) {
  return (b.getTime() - a.getTime()) / (1000 * 60 * 60);
}

function isWeekend(date) {
  const d = date.getDay();
  return d === 0 || d === 6;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function addDays(date, n) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n, date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds());
}

function validateShifts(shifts) {
  const errors = [];
  let totalHours = 0;
  const seenOverlaps = []; // optional: could check overlapping shifts

  if (!Array.isArray(shifts) || shifts.length === 0) {
    errors.push('At least one shift is required.');
    return { valid: false, errors, totalHours: 0 };
  }

  for (let i = 0; i < shifts.length; i++) {
    const s = shifts[i];
    const start = parseDate(s.start);
    const end = parseDate(s.end);

    if (!(start instanceof Date) || isNaN(start) || !(end instanceof Date) || isNaN(end)) {
      errors.push(`Shift ${i + 1}: invalid start or end datetime.`);
      continue;
    }
    if (end <= start) {
      errors.push(`Shift ${i + 1}: end must be after start.`);
      continue;
    }

    // quarter-hour start minute
    const mins = start.getMinutes();
    if (![0, 15, 30, 45].includes(mins)) {
      errors.push(`Shift ${i + 1}: start minute must be on a quarter-hour (00, 15, 30, 45).`);
    }

    // Duration in milliseconds
    const ms = end.getTime() - start.getTime();
    const hours = ms / (1000 * 60 * 60);

    // integer hour increments required
    const EPS = 1e-9;
    if (Math.abs(hours - Math.round(hours)) > EPS) {
      errors.push(`Shift ${i + 1}: duration must be in whole 1-hour increments (e.g., 4, 5 hours). Currently ${hours.toFixed(2)} hours.`);
    }

    // minimum 4 hours
    if (hours < 4 - EPS) {
      errors.push(`Shift ${i + 1}: each shift must be at least 4 hours. Currently ${hours.toFixed(2)} hours.`);
    }

    totalHours += hours;
  }

  // weekly minimum check (sum of provided shifts must be >= 20)
  if (totalHours < 20 - 1e-9) {
    errors.push(`Total hours across provided shifts = ${Math.round(totalHours * 100) / 100}. Minimum required per week is 20 hours.`);
  }

  return { valid: errors.length === 0, errors, totalHours };
}

function calculateCostWithValidation(shifts) {
  const validation = validateShifts(shifts);
  if (!validation.valid) {
    return { valid: false, errors: validation.errors, totalHours: validation.totalHours };
  }

  const baseRate = 37.0;
  const overnightDiff = 4.0;
  const weekendDiff = 4.0;

  const breakdown = [];
  let total = 0;

  for (const s of shifts) {
    const start = parseDate(s.start);
    const end = parseDate(s.end);

    // iterate per calendar day from start to end
    let dayCursor = startOfDay(start);
    const endDay = startOfDay(end);
    while (dayCursor <= endDay) {
      const dayStart = dayCursor;
      const nextDayStart = addDays(dayCursor, 1);

      // compute overlap of shift with this calendar day
      const dayOverlap = clampRange(start, end, dayStart, nextDayStart);
      if (dayOverlap) {
        // define day-window 06:00 - 22:00 for this day
        const dayWindowStart = new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate(), 6, 0, 0, 0);
        const dayWindowEnd   = new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate(), 22, 0, 0, 0);

        // daytime segment (within 06:00-22:00)
        const daySeg = clampRange(dayOverlap.start, dayOverlap.end, dayWindowStart, dayWindowEnd);
        if (daySeg) {
          const hrs = hoursBetween(daySeg.start, daySeg.end);
          const isWknd = isWeekend(daySeg.start);
          const diffWeekend = isWknd ? weekendDiff : 0;
          const diffOvernight = 0; // daytime -> no overnight diff
          const rate = baseRate + diffOvernight + diffWeekend;
          const amount = hrs * rate;
          breakdown.push({
            start: daySeg.start.toISOString(),
            end: daySeg.end.toISOString(),
            hours: hrs,
            base: baseRate,
            overnightDiff: diffOvernight,
            weekendDiff: diffWeekend,
            rate,
            amount
          });
          total += amount;
        }

        // overnight segments (00:00-06:00 and 22:00-24:00)
        const overnightSeg1 = clampRange(dayOverlap.start, dayOverlap.end, dayStart, dayWindowStart);
        if (overnightSeg1) {
          const hrs = hoursBetween(overnightSeg1.start, overnightSeg1.end);
          const isWknd = isWeekend(overnightSeg1.start);
          const diffWeekend = isWknd ? weekendDiff : 0;
          const diffOvernight = overnightDiff;
          const rate = baseRate + diffOvernight + diffWeekend;
          const amount = hrs * rate;
          breakdown.push({
            start: overnightSeg1.start.toISOString(),
            end: overnightSeg1.end.toISOString(),
            hours: hrs,
            base: baseRate,
            overnightDiff: diffOvernight,
            weekendDiff: diffWeekend,
            rate,
            amount
          });
          total += amount;
        }

        const overnightSeg2 = clampRange(dayOverlap.start, dayOverlap.end, dayWindowEnd, nextDayStart);
        if (overnightSeg2) {
          const hrs = hoursBetween(overnightSeg2.start, overnightSeg2.end);
          const isWknd = isWeekend(overnightSeg2.start);
          const diffWeekend = isWknd ? weekendDiff : 0;
          const diffOvernight = overnightDiff;
          const rate = baseRate + diffOvernight + diffWeekend;
          const amount = hrs * rate;
          breakdown.push({
            start: overnightSeg2.start.toISOString(),
            end: overnightSeg2.end.toISOString(),
            hours: hrs,
            base: baseRate,
            overnightDiff: diffOvernight,
            weekendDiff: diffWeekend,
            rate,
            amount
          });
          total += amount;
        }
      }

      dayCursor = nextDayStart;
    }
  }

  const roundedBreakdown = breakdown.map(b => ({
    start: b.start,
    end: b.end,
    hours: Math.round(b.hours * 100) / 100,
    base: b.base,
    overnightDiff: b.overnightDiff,
    weekendDiff: b.weekendDiff,
    rate: Math.round(b.rate * 100) / 100,
    amount: Math.round(b.amount * 100) / 100
  }));

  return {
    valid: true,
    total: Math.round(total * 100) / 100,
    breakdown: roundedBreakdown
  };
}

// Export for Node or attach to window for browser
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { calculateCostWithValidation, validateShifts };
}

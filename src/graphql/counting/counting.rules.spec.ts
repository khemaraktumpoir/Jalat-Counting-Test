import { inSchedule, timeOfDay } from './counting.rules';

describe('inSchedule', () => {
  it('runs all day without a schedule', () => {
    expect(inSchedule({ startTime: null, endTime: null }, '03:00')).toBe(true);
  });

  it('runs from the start up to (not at) the end', () => {
    const day = { startTime: '08:00', endTime: '17:30' };
    expect(inSchedule(day, '07:59')).toBe(false);
    expect(inSchedule(day, '08:00')).toBe(true);
    expect(inSchedule(day, '17:29')).toBe(true);
    expect(inSchedule(day, '17:30')).toBe(false);
  });

  it('runs over midnight when the end is before the start', () => {
    const night = { startTime: '22:00', endTime: '06:00' };
    expect(inSchedule(night, '23:15')).toBe(true);
    expect(inSchedule(night, '05:59')).toBe(true);
    expect(inSchedule(night, '12:00')).toBe(false);
  });
});

describe('timeOfDay', () => {
  it("reads the time in the warehouses' time zone", () => {
    expect(timeOfDay(new Date('2026-10-30T01:05:00Z'), 'Asia/Phnom_Penh')).toBe('08:05');
    expect(timeOfDay(new Date('2026-10-30T17:00:00Z'), 'Asia/Phnom_Penh')).toBe('00:00');
  });
});

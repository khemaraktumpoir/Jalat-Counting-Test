import * as _moment from 'moment';
import * as _momentZone from 'moment-timezone';

import { C } from '@common';

// import { moment } from './misc';

export const addCurrentDay = (day: number): Date => {
  const today = new Date();
  today.setDate(today.getDate() + day);
  return today;
};

export const getMonthList = (
  year: number = new Date().getFullYear(),
  locales?: string | string[],
  format: 'long' | 'short' = 'long'
): string[] => {
  const monthList = [...Array(12).keys()]; // [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
  const formatter = new Intl.DateTimeFormat(locales, {
    month: format
  });

  const getMonthName = (monthIndex: number) => formatter.format(new Date(year, monthIndex));

  return monthList.map(getMonthName);
};

export const getPrefixDate = (): string => {
  const now = new Date();
  const date = _moment(now).format('YYMMDD');

  return date;
};

export const formatDate = (date: Date, format: string): string => {
  return _moment(date).format(format);
};

export const getIOSDate = (date: Date, locales?: string, timezone?: string): Date => {
  const timeZone = !timezone ? 'Asia/Phnom_Penh' : timezone;
  const locale = !locales ? 'KH' : locales;
  return new Date(`${date.toLocaleString(`en-${locale}`, { timeZone })}`);
};

export const getLocalDateString = (date: Date, locales?: string, timezone?: string): string => {
  const timeZone = !timezone ? 'Asia/Phnom_Penh' : timezone;
  const locale = !locales ? 'KH' : locales;
  return date.toLocaleString(`en-${locale}`, { timeZone });
};

/**
 *
 * @param date new Date()
 * @param timezone Asia/Phnom_Penh
 * @param time h:m:s AM/PM
 * @returns new Date()
 */

export const getBookingExpiredTime = (date: Date, timezone?: string, time?: string): Date => {
  const t = !time ? '10:30:00 AM' : time;
  const input = `${date.toLocaleDateString()} ${t}`;
  const fmt = 'MM/DD/YYYY h:mm:ss A'; // must match the input
  const zone = !timezone ? 'Asia/Phnom_Penh' : timezone;

  // construct a moment object
  // eslint-disable-next-line import/namespace
  const m = _moment.tz(input, fmt, zone);

  return new Date(m.utc().toString());
};

export const convertLocalDateToISODate = (date: Date, timezone?: string): Date => {
  const zone = !timezone ? 'Asia/Phnom_Penh' : timezone;
  // eslint-disable-next-line import/namespace
  const m = _moment.tz(date.getTime(), zone);

  return new Date(m.utc().toString());
};

export const isToday = (startAt: Date, endAt: Date) => {
  if (!startAt || !endAt) return true;

  const currentTime = new Date().getTime();
  const startTime = new Date(startAt).getTime();
  const endTime = new Date(endAt).getTime();
  return !(startTime < currentTime && endTime < currentTime);
};

export const getStartEndDate = (date?: Date | string) => {
  // const currentDate = _moment(getIOSDate(new Date()));
  const currentDate = date ? _moment(date) : _moment();
  const start = currentDate.clone().startOf('day').toDate();
  const end = currentDate.clone().endOf('day').toDate();
  // const start = moment.dayStart(currentDate).toDate();
  // const end = moment.dayEnd(currentDate).toDate();

  return { start, end };
};

export const convertDateToString = (
  date: Date,
  format = 'YYYY-MM-DD',
  timezone = 'Asia/Phnom_Penh'
): string => {
  return _moment(date).tz(timezone).format(format);
};

export const toCronHourMinute = (time: string, timezone = C.TIME_ZONE) => {
  const dt = _momentZone(time, 'HH:mm').tz(timezone);
  return {
    hour: dt.hour,
    minute: dt.minute
  };
};

/** A day in a time zone (Phnom Penh by default) as a UTC range: start 00:00, end 23:59:59.999. */
export const getZoneDayRange = (now: Date | number = Date.now(), timezone = C.TIME_ZONE) => {
  // eslint-disable-next-line import/namespace
  const day = _moment.tz(now, timezone);
  return { start: day.clone().startOf('day').toDate(), end: day.clone().endOf('day').toDate() };
};

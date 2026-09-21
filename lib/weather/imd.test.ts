import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  addDays,
  hazardCodes,
  imdDistrictId,
  issuedAtFrom,
  numberFrom,
  observedAt,
  rowToWarnings,
  severityFromColour,
  toForecast,
  toReading,
  warningRows,
} from './imd';
import type { DistrictId } from './types';

const DISTRICT = 'Barabanki' as DistrictId;
const ENDPOINT = '/api/v1/districtwarning';

/** One real row, copied from a live response for Obj_id 573. */
const LIVE_ROW = {
  Obj_id: '573',
  Date: '2026-09-21',
  District: 'NICOBAR',
  Day_1: '2,4,8',
  Day_2: '4,8',
  Day_3: '4,8',
  Day_4: '4,8',
  Day_5: '1',
  Day1_Color: '3',
  Day2_Color: '3',
  Day3_Color: '3',
  Day4_Color: '3',
  Day5_Color: '4',
  updated_at: '2026-09-21 07:53:58',
};

/* ---- the colour scale, which runs downwards --------------------------- */

test('IMD colours map DOWNWARDS onto severity', () => {
  // The single most dangerous line in the adapter. Reading this the intuitive
  // way round renders every green day as orange and every red one as no
  // warning at all. Established from 3,590 day-slots across all 718
  // districts, because IMD publishes no legend endpoint.
  assert.equal(severityFromColour('1'), 'warning'); // red
  assert.equal(severityFromColour('2'), 'alert'); //   orange
  assert.equal(severityFromColour('3'), 'watch'); //   yellow
  assert.equal(severityFromColour('4'), 'none'); //    green
});

test('a colour arrives as a string or a number and means the same thing', () => {
  assert.equal(severityFromColour(3), 'watch');
  assert.equal(severityFromColour(' 1 '), 'warning');
});

test('a colour outside the four is refused, never rounded to the nearest', () => {
  for (const value of ['0', '5', '', 'red', 'orange', null, undefined, {}, []]) {
    assert.equal(severityFromColour(value), null, JSON.stringify(value));
  }
});

/* ---- hazard codes ----------------------------------------------------- */

test('code 1 is IMD saying nothing is in force, not a hazard', () => {
  assert.deepEqual(hazardCodes('1'), []);
  assert.deepEqual(hazardCodes('2,4,8'), ['2', '4', '8']);
  assert.deepEqual(hazardCodes('4, 8'), ['4', '8']);
  assert.deepEqual(hazardCodes(''), []);
  assert.deepEqual(hazardCodes(null), []);
});

/* ---- dates ------------------------------------------------------------ */

test('the five days are counted from the bulletin date', () => {
  assert.equal(addDays('2026-09-21', 0), '2026-09-21');
  assert.equal(addDays('2026-09-21', 4), '2026-09-25');
  // Month and year boundaries, which is where naive arithmetic breaks.
  assert.equal(addDays('2026-09-30', 1), '2026-10-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('not-a-date', 1), null);
});

test('IMD stamps its bulletin time in IST with no offset, so one is supplied', () => {
  // Read as UTC this would be five and a half hours wrong, which puts a
  // warning in the wrong part of the day.
  assert.equal(issuedAtFrom('2026-09-21 07:53:58'), '2026-09-21T02:23:58.000Z');
  assert.equal(issuedAtFrom('nonsense'), null);
  assert.equal(issuedAtFrom(null), null);
});

/* ---- the payload ------------------------------------------------------ */

test('IMD returns a bare array, and anything else is not understood', () => {
  assert.deepEqual(warningRows([LIVE_ROW]), [LIVE_ROW]);
  // null means "we did not understand this" and becomes noData. An empty
  // array means IMD said nothing is in force. Collapsing the first into the
  // second would turn a parsing failure into an all-clear.
  assert.equal(warningRows({ status: 'ok' }), null);
  assert.equal(warningRows('nope'), null);
  assert.equal(warningRows(null), null);
});

test('a live row becomes one warning per day that has one', () => {
  const { warnings, readable } = rowToWarnings(LIVE_ROW, DISTRICT, ENDPOINT);
  assert.equal(readable, true);
  // Days 1-4 are colour 3; day 5 is green and yields nothing.
  assert.equal(warnings.length, 4);

  const [first] = warnings;
  assert.equal(first.severity, 'watch');
  assert.equal(first.code, '2,4,8');
  assert.equal(first.district, DISTRICT);
  assert.equal(first.validFrom, '2026-09-21T00:00:00+05:30');
  assert.equal(first.validTo, '2026-09-22T00:00:00+05:30');
  assert.equal(first.provenance.source, 'IMD');
  assert.equal(first.provenance.issuedAt, '2026-09-21T02:23:58.000Z');
  assert.equal(first.provenance.timeBasis, 'issued');

  // Day four is still within the five-day window.
  assert.equal(warnings[3].validFrom, '2026-09-24T00:00:00+05:30');
});

test('a green day produces no warning at all', () => {
  const green = { ...LIVE_ROW };
  for (let d = 1; d <= 5; d++) {
    (green as Record<string, string>)[`Day${d}_Color`] = '4';
    (green as Record<string, string>)[`Day_${d}`] = '1';
  }
  const { warnings, readable } = rowToWarnings(green, DISTRICT, ENDPOINT);
  assert.equal(warnings.length, 0);
  // Understood, and it said nothing is in force. That is noWarning, which is
  // a different answer from noData.
  assert.equal(readable, true);
});

test('a row nobody can read is not mistaken for an all-clear', () => {
  const garbled = { ...LIVE_ROW };
  for (let d = 1; d <= 5; d++) {
    (garbled as Record<string, string>)[`Day${d}_Color`] = '9';
  }
  const { warnings, readable } = rowToWarnings(garbled, DISTRICT, ENDPOINT);
  assert.equal(warnings.length, 0);
  // The distinction the caller turns into noData rather than "nothing in
  // force". Silence about a cyclone is the dangerous direction.
  assert.equal(readable, false);
});

test('a row with no bulletin date yields nothing', () => {
  const { warnings, readable } = rowToWarnings({ ...LIVE_ROW, Date: '' }, DISTRICT, ENDPOINT);
  assert.equal(warnings.length, 0);
  assert.equal(readable, false);
});

test('a day with a severity but no hazard code still becomes a warning', () => {
  // IMD colouring a day without listing a code is IMD saying something is in
  // force. Dropping it because the code list was empty would lose it.
  const row = { ...LIVE_ROW, Day_1: '', Day1_Color: '1' };
  const { warnings } = rowToWarnings(row, DISTRICT, ENDPOINT);
  assert.equal(warnings[0].severity, 'warning');
  assert.equal(warnings[0].code, 'unspecified');
});

test('warning ids are stable across polls so dispatch deduplicates', () => {
  const a = rowToWarnings(LIVE_ROW, DISTRICT, ENDPOINT).warnings;
  const b = rowToWarnings(LIVE_ROW, DISTRICT, ENDPOINT).warnings;
  assert.deepEqual(a.map((w) => w.id), b.map((w) => w.id));
  assert.equal(new Set(a.map((w) => w.id)).size, a.length, 'ids collided within one row');
  assert.match(a[0].id, /^imd:573:2026-09-21:d1$/);
});

/* ---- the district join ------------------------------------------------ */

test('a numeric Obj_id passes straight through', () => {
  assert.equal(imdDistrictId('573' as DistrictId), '573');
});

test('a district name resolves against IMD own register', () => {
  // IMD spells several districts its own way, and refusing those would lose
  // real warnings for real places.
  assert.equal(imdDistrictId('Barabanki' as DistrictId), '440');
  assert.equal(imdDistrictId('Nainital' as DistrictId), '516');
  assert.equal(imdDistrictId('Kolkata' as DistrictId), '237');
  assert.equal(imdDistrictId('Tirunelveli' as DistrictId), '35');
});

test('a district IMD does not cover resolves to nothing, not to a neighbour', () => {
  // IMD's register holds 718 districts and does not cover the whole country.
  // Saying so is honest; attaching the nearest district's warning is not.
  for (const name of ['Zzzznotadistrict', '', 'Atlantis']) {
    assert.equal(imdDistrictId(name as DistrictId), null, name);
  }
});

/* ---- readings and the forecast ---------------------------------------- */

/** A real current_wx row, copied from a live response. */
const LIVE_OBSERVATION = {
  'Station Id': '42647',
  Station: 'Ahmedabad',
  'Date of Observation': '2026-09-21',
  Time: '7',
  'Wind Speed KMPH': '7.4',
  Temperature: '32',
  'Weather Code': '5',
  Humidity: '63',
  'Last 24 hrs Rainfall': '0',
  'Feel Like': '38',
};

test('IMD sends every value as a string, and absence in three different ways', () => {
  assert.equal(numberFrom('32'), 32);
  assert.equal(numberFrom('7.4'), 7.4);
  assert.equal(numberFrom(29), 29);
  // "NIL" is how rainfall says none was recorded. It is not a zero, and
  // reading it as one would invent a measurement.
  assert.equal(numberFrom('NIL'), null);
  assert.equal(numberFrom(''), null);
  assert.equal(numberFrom(null), null);
  assert.equal(numberFrom(undefined), null);
  assert.equal(numberFrom('-'), null);
  assert.equal(numberFrom('cloudy'), null);
});

test('an observation time is read as IST, not as UTC', () => {
  // Hour 7 in Ahmedabad is 01:30 UTC. Read as UTC it would be five and a half
  // hours adrift, which moves a reading into the wrong part of the day.
  assert.equal(observedAt('2026-09-21', '7'), '2026-09-21T01:30:00.000Z');
  assert.equal(observedAt('2026-09-21', null), '2026-09-20T18:30:00.000Z');
  assert.equal(observedAt('nonsense', '7'), null);
});

test('a live observation row becomes a reading carrying IMD as its source', () => {
  const reading = toReading(LIVE_OBSERVATION, '/api/v1/current_wx');
  assert.ok(reading);
  assert.equal(reading.provenance.source, 'IMD');
  assert.equal(reading.provenance.issuedAt, '2026-09-21T01:30:00.000Z');
  const byKey = Object.fromEntries(reading.measurements.map((m) => [m.key, m]));
  assert.equal(byKey.temperature.value, 32);
  assert.equal(byKey.temperature.unit, '°C');
  assert.equal(byKey.humidity.value, 63);
  assert.equal(byKey.windSpeed.value, 7.4);
  assert.equal(byKey.windSpeed.unit, 'km/h');
  assert.equal(byKey.apparentTemperature.value, 38);
});

test('IMD weather code is NEVER passed off as a WMO code', () => {
  // The condition words everything above the adapter renders are keyed on WMO.
  // IMD sends its own numbering, so handing "5" through would print the wrong
  // weather in words -- fluent, plausible and wrong.
  const reading = toReading(LIVE_OBSERVATION, '/api/v1/current_wx');
  assert.ok(reading);
  assert.equal(reading.conditionCode, null);
});

test('a row with nothing measured is not a reading full of blanks', () => {
  const empty = { ...LIVE_OBSERVATION, Temperature: 'NIL', Humidity: '', 'Wind Speed KMPH': null, 'Feel Like': '', 'Last 24 hrs Rainfall': 'NIL' };
  assert.equal(toReading(empty, '/api/v1/current_wx'), null);
});

test('a reading with no observation time is refused', () => {
  assert.equal(toReading({ ...LIVE_OBSERVATION, 'Date of Observation': '' }, '/x'), null);
});

/** A real cityforecast row, copied from a live response. */
const LIVE_FORECAST = {
  Date: '2026-09-21',
  Station_Code: '42184',
  Station_Name: 'New Delhi-Ridge',
  Todays_Forecast_Max_Temp: '34.0',
  Todays_Forecast_Min_temp: '21.0',
  Day_2_Max_Temp: '35.0',
  Day_2_Min_temp: '21.0',
  Day_3_Max_Temp: '35.0',
  Day_3_Min_temp: '21.0',
};

test('day one is today and later days count forward from the bulletin date', () => {
  const forecast = toForecast(LIVE_FORECAST, 3, '/api/v1/cityforecast');
  assert.ok(forecast);
  assert.equal(forecast.days.length, 3);
  assert.equal(forecast.days[0].date, '2026-09-21');
  assert.equal(forecast.days[0].maxTemp, 34);
  assert.equal(forecast.days[1].date, '2026-09-22');
  assert.equal(forecast.days[1].maxTemp, 35);
  assert.equal(forecast.days[2].date, '2026-09-23');
  assert.equal(forecast.provenance.source, 'IMD');
});

test('rainfall IMD does not publish stays absent, never zero', () => {
  // A zero here would be a forecast of no rain, which is a claim nobody made.
  const forecast = toForecast(LIVE_FORECAST, 3, '/api/v1/cityforecast');
  assert.ok(forecast);
  for (const day of forecast.days) {
    assert.equal(day.precipitationSum, null);
    assert.equal(day.conditionCode, null);
  }
});

test('a forecast is asked for only as many days as it was asked for', () => {
  assert.equal(toForecast(LIVE_FORECAST, 1, '/x')?.days.length, 1);
  // Beyond what the row carries, days are dropped rather than invented.
  assert.equal(toForecast(LIVE_FORECAST, 7, '/x')?.days.length, 3);
});

test('a forecast with no usable day is not a forecast', () => {
  assert.equal(toForecast({ Date: '2026-09-21' }, 3, '/x'), null);
  assert.equal(toForecast({ ...LIVE_FORECAST, Date: '' }, 3, '/x'), null);
});

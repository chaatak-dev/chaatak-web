/**
 * What Chaatak looks like in Telegram — and what it must never do there:
 * round a value, re-word a severity, blur a warning into an all-clear, or let
 * someone's text break the markup.
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { renderAlert } from '../alerts/templates';
import type { AlertPayload } from '../alerts/types';
import type { DistrictId, NoWarning } from '../weather/types';
import { answerFor, GHAZIABAD, minutesAgo, MODINAGAR, NO_WARNING_PRODUCT, orangeWarning, snapshot } from './fixtures';
import {
  alertMessage,
  answerMessage,
  askPlaceMessage,
  commandMenu,
  mainKeyboard,
  placeKey,
  settingsMessage,
  weatherCard,
  welcomeMessage,
  withUnit,
} from './render';
import type { InlineKeyboard } from './types';

function buttons(markup: unknown): { text: string; callback_data?: string; url?: string }[] {
  return ((markup as InlineKeyboard | undefined)?.inline_keyboard ?? []).flat() as never;
}

/* ---- values ---------------------------------------------------------- */

test('values are printed exactly as the adapter returned them, with its units', () => {
  const { html } = weatherCard(snapshot(), 'en', { watch: 'offer' });
  assert.ok(html.includes('31.27°C'), 'temperature, unrounded');
  assert.ok(html.includes('36.08°C'), 'feels like, unrounded');
  assert.ok(html.includes('71%'));
  assert.ok(html.includes('12.4 km/h'));
  assert.ok(html.includes('33.1°C / 26.4°C'));
  assert.ok(html.includes('12.3 mm'));
  assert.ok(!html.includes('31.3') && !html.includes('36.1°'), 'nothing rounded');
});

test('a value the source did not give is a dash, never filled in', () => {
  const { html } = weatherCard(snapshot(), 'en', { watch: 'offer' });
  assert.ok(html.includes('— / 27°C'));
});

test('every block carries its own provenance, with the kind of value it is', () => {
  const { html } = weatherCard(snapshot(), 'en', { watch: 'offer' });
  // The fixture stamps its values minutes before now, so just after midnight
  // they fall on yesterday and the stamp rightly gains its date — "23 Sept,
  // 23:56 IST". The date is optional here; the time never is.
  assert.match(html, /Open-Meteo · model · Updated (\d{1,2} \w+, )?\d\d:\d\d IST/);
  assert.match(html, /IMD · bulletin · Issued (\d{1,2} \w+, )?\d\d:\d\d IST/);
  assert.ok(!html.includes('/v1/forecast') && !html.includes('districtwarning'), 'no endpoint is ever shown');
});

test('a stale reading is not called "now", and says how old it is', () => {
  const stale = snapshot();
  if (stale.current.kind === 'reading') stale.current.provenance.issuedAt = minutesAgo(6 * 60);
  const { html } = weatherCard(stale, 'en', { watch: 'offer' });
  assert.ok(!html.includes('Now 31.27'), 'not presented as now');
  assert.ok(html.includes('31.27°C'), 'the value is still shown');
  assert.match(html, /not right now/);
});

/* ---- severity --------------------------------------------------------- */

test('a warning leads the card, in the catalogue’s words, with IMD’s hazard', () => {
  const { html } = weatherCard(snapshot(), 'en', { watch: 'offer' });
  const first = html.split('\n\n')[1];
  assert.ok(first.startsWith('🟠 <b>Orange warning</b> · Be prepared'), first);
  assert.ok(first.includes('Heavy Rain'));

  const hi = weatherCard(snapshot(), 'hi', { watch: 'offer' }).html;
  assert.ok(hi.includes('नारंगी चेतावनी'));
  assert.ok(hi.includes('भारी वर्षा'));
});

test('no warning and no data are different statements, never collapsed', () => {
  const noWarning: NoWarning = {
    kind: 'noWarning',
    source: 'IMD',
    endpoint: 'x',
    issuedAt: minutesAgo(30),
    checkedAt: minutesAgo(1),
    timeBasis: 'issued',
  };
  const settled = weatherCard(snapshot({ warnings: noWarning }), 'en', { watch: 'offer' }).html;
  assert.ok(settled.includes('🟢 No IMD warning in force'));

  const unknown = weatherCard(snapshot({ warnings: NO_WARNING_PRODUCT }), 'en', { watch: 'offer' }).html;
  assert.ok(unknown.includes('This source issues no warnings.'));
  assert.ok(!unknown.includes('No IMD warning in force'), 'we do not know is not an all-clear');
  assert.ok(!unknown.includes('🟢'));
});

test('the loudest warning comes first', () => {
  const red = orangeWarning({ id: 'R', severity: 'warning', code: '17' });
  const { html } = weatherCard(snapshot({ warnings: [orangeWarning(), red] }), 'en', { watch: 'offer' });
  assert.ok(html.indexOf('Red warning') < html.indexOf('Orange warning'));
});

/* ---- answers ---------------------------------------------------------- */

test('an answer is the pipeline’s text, escaped, with severity above and provenance below', () => {
  const { html, markup } = answerMessage(
    answerFor('Rain <b>likely</b> & heavy — take an umbrella.').reply,
    'en',
    { offerWatch: true },
  );
  assert.ok(html.startsWith('🟠 <b>Orange warning</b>'));
  assert.ok(html.includes('Rain &lt;b&gt;likely&lt;/b&gt; &amp; heavy'), 'model text cannot inject markup');
  assert.ok(html.includes('📍 Ghaziabad, Uttar Pradesh'));
  assert.match(html, /Open-Meteo · model · Updated/);
  assert.match(html, /IMD · bulletin · Issued/);

  const labels = buttons(markup).map((b) => b.text);
  assert.ok(labels.includes('📅 Three-day forecast'));
  assert.ok(labels.includes('🔔 Get alerts for Ghaziabad'));
});

test('an answer that fetched nothing carries no citation and no buttons', () => {
  const { html, markup } = answerMessage(answerFor('Orange means be prepared.', { snap: null }).reply, 'en', {
    offerWatch: true,
  });
  assert.equal(html, 'Orange means be prepared.');
  assert.equal(markup, undefined);
});

/* ---- buttons ---------------------------------------------------------- */

test('every callback fits Telegram’s 64-byte limit', () => {
  const all = [
    ...buttons(weatherCard(snapshot(), 'hi', { watch: 'offer' }).markup),
    ...buttons(answerMessage(answerFor('x').reply, 'hi', { offerWatch: true }).markup),
    ...buttons(settingsMessage('hi', { linked: true, account: 'Y', assistant: 'auto' }).markup),
    ...buttons(
      askPlaceMessage('Which?', 'en', [
        {
          id: '00000000-0000-4000-8000-000000000001',
          slot: 1,
          placeName: 'Barabanki',
          district: 'Barabanki' as DistrictId,
          state: 'Uttar Pradesh',
          latitude: 26.9268,
          longitude: 81.1834,
          timezone: 'Asia/Kolkata',
          resolvedBy: null,
          endpoint: null,
          createdAt: '',
        },
      ], 'pq').markup,
    ),
  ];
  for (const button of all) {
    if (button.callback_data) {
      assert.ok(Buffer.byteLength(button.callback_data, 'utf8') <= 64, button.callback_data);
    }
  }
});

test('a place key is four decimals of the canonical coordinate', () => {
  assert.equal(placeKey(GHAZIABAD), '28.6692,77.4538');
  assert.notEqual(placeKey(GHAZIABAD), placeKey(MODINAGAR));
});

test('the watch button is offered only when there is something to offer', () => {
  const labels = (watch: 'offer' | 'watching' | 'none') =>
    buttons(weatherCard(snapshot(), 'en', { watch }).markup).map((b) => b.text);
  assert.ok(labels('offer').some((l) => l.startsWith('🔔')));
  assert.ok(!labels('watching').some((l) => l.startsWith('🔔')));
  assert.ok(!labels('none').some((l) => l.startsWith('🔔')));
});

test('the main keyboard asks Telegram for the location, not us', () => {
  const keyboard = mainKeyboard('hi');
  assert.equal(keyboard.keyboard[0][0].request_location, true);
  assert.equal(keyboard.is_persistent, true);
  assert.match(keyboard.keyboard[0][0].text, /📍/);
});

test('the command menu exists in both languages, with the same commands', () => {
  const en = commandMenu('en').map((c) => c.command);
  const hi = commandMenu('hi').map((c) => c.command);
  assert.deepEqual(en, hi);
  assert.deepEqual(en, ['weather', 'locations', 'alerts', 'settings', 'help']);
  for (const c of commandMenu('hi')) assert.match(c.description, /[ऀ-ॿ]/);
});

test('a guest is invited to connect; a linked account is told where alerts go', () => {
  const guest = welcomeMessage('en', 'Hello.', { linked: false }).html;
  assert.ok(guest.includes('/?connect=telegram'));
  const linked = welcomeMessage('en', 'Hello.', { linked: true, alertsOn: true, account: 'Y' }).html;
  assert.ok(!linked.includes('connect=telegram'));
  assert.ok(linked.includes('Warnings for your saved places arrive here.'));
});

/* ---- alerts ----------------------------------------------------------- */

function payload(kind: 'warning' | 'allClear'): AlertPayload {
  const w = orangeWarning();
  return {
    kind,
    district: w.district,
    warningId: w.id,
    code: kind === 'warning' ? w.code : '',
    severity: w.severity,
    validFrom: w.validFrom,
    validTo: w.validTo,
    provenance: w.provenance,
  };
}

test('an alert says it is an official IMD warning, in the catalogue’s words', () => {
  const message = alertMessage(renderAlert(payload('warning'), 'en'), 'https://chaatak.com');
  const [head] = message.html.split('\n\n');
  assert.ok(head.startsWith('🟠 <b>Orange warning</b> · Official IMD warning'), head);
  assert.ok(message.html.includes('<b>Heavy Rain</b>'));
  assert.ok(message.html.includes('<b>Be prepared.</b>'));
  assert.match(message.html, /IMD · bulletin · Issued \d\d:\d\d IST/);
  assert.notEqual(message.silent, true, 'a warning makes a sound');

  const labels = buttons(message.markup);
  assert.equal(labels[0].callback_data, 'ad:Ghaziabad');
  assert.equal(labels[1].url, 'https://chaatak.com');
});

test('the Hindi alert uses the Hindi catalogue, not a translation of the English', () => {
  const message = alertMessage(renderAlert(payload('warning'), 'hi'));
  assert.ok(message.html.includes('नारंगी चेतावनी'));
  assert.ok(message.html.includes('IMD की आधिकारिक चेतावनी'));
  assert.ok(message.html.includes('भारी वर्षा'));
  assert.ok(message.html.includes('तैयार रहें।'));
});

test('an all-clear is delivered silently', () => {
  const message = alertMessage(renderAlert(payload('allClear'), 'en'));
  assert.equal(message.silent, true);
  assert.ok(message.html.includes('is no longer in force'));
  assert.ok(message.html.startsWith('🟢'));
});

test('units stay attached the way the website shows them', () => {
  assert.equal(withUnit(31.27, '°C'), '31.27°C');
  assert.equal(withUnit(71, '%'), '71%');
  assert.equal(withUnit(12.4, 'km/h'), '12.4 km/h');
});

test('a district already named "District" is not called "District district"', () => {
  const place = { ...GHAZIABAD, name: 'Atlantis', admin2: 'Mumbai Suburban District', admin1: 'Maharashtra' };
  const { html } = weatherCard(snapshot({}, place), 'en', { watch: 'offer' });
  assert.ok(html.startsWith('<b>Atlantis</b> · Mumbai Suburban district, Maharashtra'), html.split('\n')[0]);
});

test('a warning above an answer says when it applies', () => {
  const { html } = answerMessage(answerFor('Rain tomorrow.').reply, 'en', { offerWatch: false });
  assert.match(html.split('\n')[0], /Heavy Rain · 23 Sept?/);
});

test('"which place?" with nothing saved brings the location key back', () => {
  const { markup } = askPlaceMessage('Which place?', 'en', [], 'pq');
  assert.equal((markup as { keyboard: { request_location?: boolean }[][] }).keyboard[0][0].request_location, true);
});

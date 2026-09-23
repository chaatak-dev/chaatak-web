/**
 * How Chaatak looks in Telegram.
 *
 * Pure: data in, HTML and buttons out. Nothing here fetches, and nothing here
 * computes a weather value — every number is printed exactly as the adapter
 * returned it, beside the unit the adapter returned, exactly as the website
 * prints it. Every word is from the string catalogue, the alert catalogue,
 * the WMO table or IMD's own code table.
 *
 * THE DESIGN, translated from the website's rather than invented:
 *
 *   Severity is the first line. The website's full-bleed band becomes a
 *   coloured mark and the severity IN WORDS, bold, at the top of the message.
 *   Colour never works alone — the mark is decoration; the words carry it.
 *
 *   Provenance sits under every value, in italics: source · what kind of
 *   value · when. Open-Meteo's lines say "model"; IMD's say "bulletin". A
 *   reader can always tell an official warning from a model's estimate.
 *
 *   Restraint. Three emoji carry meaning (severity, 📍 place, 🔔 alerts) and
 *   nothing is decorated for its own sake. At most two rows of buttons, and
 *   one primary action per message.
 */

import { severityAction, severityWords, type RenderedAlert } from '../alerts/templates';
import type { MonitoredLocation } from '../accounts/types';
import type { ChatReply } from '../chat/answer';
import { formatDayLabel, formatStamp, placeLine } from '../format';
import { LANGUAGES, type InterfaceLang, type LanguageCode } from '../i18n/languages';
import type { LanguagePreference } from '../i18n/preferences';
import { translate, type StringKey, type Vars } from '../i18n/strings';
import { ageLabel } from '../offline/cache';
import type { WeatherSnapshot } from '../weather/api';
import { freshness } from '../weather/freshness';
import { readHazards } from '../weather/imd-codes';
import { districtOf, warningsInForce } from '../weather/snapshot';
import type {
  Forecast,
  Location,
  Measurement,
  NoData,
  NoWarning,
  Provenance,
  Reading,
  Severity,
  Warning,
} from '../weather/types';
import { conditionFor } from '../weather/wmo';
import { b, blocks, esc, i, lines } from './html';
import type {
  InlineButton,
  InlineKeyboard,
  OutgoingMessage,
  ReplyKeyboard,
} from './types';

/* ------------------------------------------------------------------ */
/* Shared pieces                                                       */
/* ------------------------------------------------------------------ */

/** Where "Open Chaatak" goes. Overridable for a preview deployment. */
export function siteUrl(env: Record<string, string | undefined> = process.env): string {
  const raw = env.CHAATAK_SITE_URL?.trim();
  return (raw && /^https:\/\//.test(raw) ? raw : 'https://chaatak.com').replace(/\/+$/, '');
}

/** Where a guest goes to connect an account: settings opens on arrival. */
export function connectUrl(site = siteUrl()): string {
  return `${site}/?connect=telegram`;
}

const tr = (lang: InterfaceLang) => (key: StringKey, vars?: Vars) => translate(key, lang, vars);

/** IMD's colour, as a mark beside the words. Never the only signal. */
const SEVERITY_MARK: Record<Severity, string> = {
  warning: '🔴',
  alert: '🟠',
  watch: '🟡',
  none: '🟢',
};

/**
 * A key for a place that fits in Telegram's 64-byte callback data: its
 * canonical coordinate, four decimals. A tap finds the same place again from
 * the chat's recent places, or from the gazetteer if it has aged out.
 */
export function placeKey(place: { latitude: number; longitude: number }): string {
  return `${place.latitude.toFixed(4)},${place.longitude.toFixed(4)}`;
}

/** "31.2°C", "70%", "12 km/h" — the value and upstream's unit, untouched. */
export function withUnit(value: number, unit: string): string {
  return /^[%°]/.test(unit) ? `${value}${unit}` : `${value} ${unit}`;
}

const BASIS: Record<Provenance['timeBasis'] | 'checked', StringKey> = {
  issued: 'provenance.issued',
  updated: 'provenance.updated',
  valid: 'provenance.valid',
  through: 'provenance.through',
  checked: 'provenance.checked',
};

const NATURE: Record<NonNullable<Provenance['nature']>, StringKey> = {
  model: 'provenance.model',
  observation: 'provenance.observation',
  bulletin: 'provenance.bulletin',
  archivedForecast: 'provenance.archivedForecast',
  reanalysis: 'provenance.reanalysis',
};

/**
 * "Open-Meteo · model · Updated 14:15 IST".
 *
 * The same line the website draws under every value, with the same words. The
 * endpoint is never shown: it tells a farmer nothing and everyone else our URL
 * structure.
 */
export function provenanceLine(
  provenance: Pick<Provenance, 'source' | 'nature' | 'issuedAt' | 'timeBasis'>,
  timeZone: string,
  lang: InterfaceLang,
): string {
  const t = tr(lang);
  const nature = provenance.nature ? ` · ${t(NATURE[provenance.nature])}` : '';
  const stamp = formatStamp(provenance.issuedAt, timeZone);
  const word = t(BASIS[provenance.timeBasis]);
  // The language's word order: "20:00 IST तक का आँकड़ा", not the reverse.
  const when = lang === 'hi' && provenance.timeBasis === 'through' ? `${stamp} ${word}` : `${word} ${stamp}`;
  return i(`${provenance.source}${nature} · ${when}`);
}

/** For an absence: when we asked, which is all there is to cite. */
function checkedLine(state: NoData, timeZone: string, lang: InterfaceLang): string {
  return i(`${state.source} · ${tr(lang)('provenance.checked')} ${formatStamp(state.checkedAt, timeZone)}`);
}

/** "23 Sep" or "23–24 Sep", in the reader's language. */
function windowIn(from: string, to: string, lang: InterfaceLang): string {
  const format = (iso: string) => {
    const at = new Date(iso);
    if (Number.isNaN(at.getTime())) return iso;
    return new Intl.DateTimeFormat(lang === 'hi' ? 'hi-IN' : 'en-GB', {
      timeZone: 'Asia/Kolkata',
      day: 'numeric',
      month: 'short',
    }).format(at);
  };
  const a = format(from);
  const z = format(to);
  return a === z ? a : `${a} – ${z}`;
}

function hazardsOf(warning: Warning, lang: InterfaceLang): string {
  const { hazards, unrecognised } = readHazards(warning.code, lang);
  const all = [...hazards, ...unrecognised];
  // An unrecognised code prints as the code: better an unfamiliar number than
  // a description nobody issued.
  return all.length > 0 ? all.join(', ') : warning.code;
}

/**
 * "Ghaziabad district". Geocoders sometimes name a district with the word
 * already in it — "Mumbai Suburban District" — and it is not said twice.
 */
function districtLabel(district: string, lang: InterfaceLang): string {
  return tr(lang)('tg.district', { district: district.replace(/\s+district$/i, '') });
}

/** "Ghaziabad · Uttar Pradesh", or "Modinagar · Ghaziabad district, Uttar Pradesh". */
function placeHeading(place: Location, lang: InterfaceLang): string {
  const district =
    place.admin2 && place.admin2 !== place.name ? districtLabel(place.admin2, lang) : null;
  const region = [district, place.admin1 && place.admin1 !== place.name ? place.admin1 : null]
    .filter(Boolean)
    .join(', ');
  return region ? `${b(place.name)} · ${esc(region)}` : b(place.name);
}

function link(url: string, text: string): string {
  return `<a href="${esc(url)}">${esc(text)}</a>`;
}

/* ------------------------------------------------------------------ */
/* The main keyboard                                                   */
/* ------------------------------------------------------------------ */

/**
 * The two things a person does most, one tap each, always there.
 *
 * "Weather here" is the Telegram-native way to share a location — Telegram
 * asks for it, not us, and only when it is pressed. It is the nearest thing a
 * chat has to the website's microphone: the largest, most obvious way in.
 */
export function mainKeyboard(lang: InterfaceLang): ReplyKeyboard {
  const t = tr(lang);
  return {
    keyboard: [[{ text: t('tg.kb.here'), request_location: true }, { text: t('tg.kb.places') }]],
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder: t('tg.kb.placeholder'),
  };
}

/** True when a message is the "My places" key, in either language. */
export function isPlacesKey(text: string): boolean {
  return (['hi', 'en'] as const).some((lang) => translate('tg.kb.places', lang) === text.trim());
}

/* ------------------------------------------------------------------ */
/* Weather blocks                                                      */
/* ------------------------------------------------------------------ */

function warningBlock(
  warnings: Warning[] | NoWarning | NoData,
  timeZone: string,
  lang: InterfaceLang,
): string {
  const t = tr(lang);

  if (Array.isArray(warnings)) {
    const inForce = warningsInForce(warnings);
    const shown = inForce.slice(0, 3);
    const rows = shown.map((w) =>
      lines(
        `${SEVERITY_MARK[w.severity]} ${b(severityWords(w.severity, lang))} · ${esc(severityAction(w.severity, lang))}`,
        esc(`${hazardsOf(w, lang)} · ${windowIn(w.validFrom, w.validTo, lang)}`),
      ),
    );
    return lines(
      ...rows,
      inForce.length > shown.length ? esc(t('tg.moreWarnings', { count: inForce.length })) : null,
      provenanceLine(inForce[0].provenance, timeZone, lang),
    );
  }

  if (warnings.kind === 'noWarning') {
    return lines(
      `${SEVERITY_MARK.none} ${esc(t('tg.noWarning'))}`,
      warnings.issuedAt
        ? provenanceLine(
            { source: warnings.source, nature: 'bulletin', issuedAt: warnings.issuedAt, timeBasis: warnings.timeBasis },
            timeZone,
            lang,
          )
        : i(`${warnings.source} · ${t('provenance.checked')} ${formatStamp(warnings.checkedAt, timeZone)}`),
    );
  }

  // We do not know. Said as a statement, in grey, never as an all-clear.
  return lines(`⚪ ${esc(warnings.statement[lang])}`, checkedLine(warnings, timeZone, lang));
}

function reading(measurements: Measurement[], key: Measurement['key']): Measurement | null {
  return measurements.find((m) => m.key === key) ?? null;
}

function conditionWords(code: number | null, lang: InterfaceLang): string | null {
  if (code === null) return null;
  const template = conditionFor(code);
  if (template) return template[lang];
  // The source said something we have no words for. Say so; never guess.
  return lang === 'hi' ? `कोड ${code}` : `code ${code}`;
}

function currentBlock(current: Reading | NoData, timeZone: string, lang: InterfaceLang): string {
  const t = tr(lang);
  if (current.kind === 'noData') {
    return lines(esc(current.statement[lang]), checkedLine(current, timeZone, lang));
  }

  const m = current.measurements;
  const temperature = reading(m, 'temperature');
  const condition = conditionWords(current.conditionCode, lang);

  /*
   * A value too old to be "now" is not called now. It keeps its number and
   * says its age, in place of the reassuring silence that once let a
   * six-hour-old observation read as current.
   */
  const age = freshness(current.provenance);
  const stale = age.state === 'stale';

  const headline = temperature
    ? `${b(`${stale ? '' : `${t('tg.now')} `}${withUnit(temperature.value, temperature.unit)}`)}${condition ? ` · ${esc(condition)}` : ''}`
    : condition
      ? b(condition)
      : null;

  const stats = (
    [
      ['apparentTemperature', 'rail.feelsLike'],
      ['humidity', 'rail.humidity'],
      ['windSpeed', 'rail.wind'],
      ['precipitation', 'rail.precipitation'],
    ] as const
  )
    .map(([key, label]) => {
      const value = reading(m, key);
      return value ? `${t(label)} ${withUnit(value.value, value.unit)}` : null;
    })
    .filter(Boolean)
    .join(' · ');

  return lines(
    headline,
    stats ? esc(stats) : null,
    stale ? esc(`⚠ ${t('rail.staleNotice', { age: ageLabel(age.ageMinutes, lang) })}`) : null,
    provenanceLine(current.provenance, timeZone, lang),
  );
}

function outlookBlock(outlook: Forecast | NoData, timeZone: string, lang: InterfaceLang): string {
  const t = tr(lang);
  if (outlook.kind === 'noData') {
    return lines(esc(outlook.statement[lang]), checkedLine(outlook, timeZone, lang));
  }

  const unit = outlook.units.temperature;
  const rows = outlook.days.map((day) => {
    const label = formatDayLabel(day.date, timeZone)[lang];
    // A value the source did not give prints as a dash. It is never filled in
    // from the day beside it.
    const max = day.maxTemp === null ? '—' : withUnit(day.maxTemp, unit);
    const min = day.minTemp === null ? '—' : withUnit(day.minTemp, unit);
    const condition = conditionWords(day.conditionCode, lang);
    const rain =
      day.precipitationSum !== null && day.precipitationSum > 0
        ? withUnit(day.precipitationSum, outlook.units.precipitation)
        : null;
    return `${b(label)} · ${esc([`${max} / ${min}`, condition, rain].filter(Boolean).join(' · '))}`;
  });

  return lines(b(t('tg.outlook')), ...rows, provenanceLine(outlook.provenance, timeZone, lang));
}

/* ------------------------------------------------------------------ */
/* The weather card                                                    */
/* ------------------------------------------------------------------ */

/**
 * Whether to offer "get alerts for this district" under a card.
 *
 *   offer     not watched yet, or a guest (the tap explains accounts)
 *   watching  already one of this account's places
 *   none      nothing to offer — the account is full
 */
export type WatchOffer = 'offer' | 'watching' | 'none';

/**
 * Everything about one place, from one snapshot: warnings first, then now,
 * then the next three days, each under its own provenance.
 *
 * The same snapshot the website's rail shows, assembled by the same function.
 */
export function weatherCard(
  snapshot: WeatherSnapshot,
  lang: InterfaceLang,
  options: { watch: WatchOffer; site?: string },
): OutgoingMessage {
  const t = tr(lang);
  const { place } = snapshot;
  const tz = place.timezone;
  const key = placeKey(place);
  const district = districtOf(place);

  const html = blocks(
    placeHeading(place, lang),
    warningBlock(snapshot.warnings, tz, lang),
    currentBlock(snapshot.current, tz, lang),
    outlookBlock(snapshot.outlook, tz, lang),
  );

  const rows: InlineButton[][] = [];
  if (options.watch === 'offer') {
    rows.push([{ text: t('tg.btn.watch', { place: district }), callback_data: `wa:${key}` }]);
  }
  rows.push([
    { text: t('tg.btn.refresh'), callback_data: `rf:${key}` },
    { text: t('tg.btn.open'), url: options.site ?? siteUrl() },
  ]);

  return { html, markup: { inline_keyboard: rows } };
}

/* ------------------------------------------------------------------ */
/* A conversational answer                                             */
/* ------------------------------------------------------------------ */

/**
 * The pipeline's verified answer, with the severity above it and the
 * provenance below it.
 *
 * The prose is the pipeline's — model-written and gate-verified, or the
 * template. This adds only what the website draws around an answer: the
 * severity, in the catalogue's words, and where the numbers came from.
 */
export function answerMessage(
  reply: ChatReply,
  lang: InterfaceLang,
  options: { offerWatch: boolean },
): OutgoingMessage {
  const t = tr(lang);
  const snapshot = reply.snapshot;
  const grounding = reply.grounding;

  let band: string | null = null;
  let imdLine: string | null = null;
  if (snapshot && Array.isArray(snapshot.warnings)) {
    const top = warningsInForce(snapshot.warnings)[0];
    // With its window: an answer about tomorrow under a warning for today
    // must not read as a warning for tomorrow.
    band = `${SEVERITY_MARK[top.severity]} ${b(severityWords(top.severity, lang))} · ${esc(
      `${hazardsOf(top, lang)} · ${windowIn(top.validFrom, top.validTo, lang)}`,
    )}`;
    imdLine = provenanceLine(top.provenance, snapshot.place.timezone, lang);
  }

  const footer = grounding
    ? lines(
        `📍 ${esc(placeLine(grounding.place))}`,
        provenanceLine(grounding.provenance, grounding.place.timezone, lang),
        imdLine,
      )
    : null;

  const html = blocks(band, esc(reply.text), footer);

  if (!snapshot) return { html };

  const key = placeKey(snapshot.place);
  const row: InlineButton[] = [{ text: t('tg.btn.forecast'), callback_data: `wx:${key}` }];
  if (options.offerWatch) {
    row.push({
      text: t('tg.btn.watch', { place: districtOf(snapshot.place) }),
      callback_data: `wa:${key}`,
    });
  }
  return { html, markup: { inline_keyboard: row.length > 1 ? [[row[0]], [row[1]]] : [row] } };
}

/**
 * "Which place?" — asked, not stated as a failure, with the person's own
 * saved places one tap away. The 📍 key under the text box answers it too.
 */
export function askPlaceMessage(
  text: string,
  lang: InterfaceLang,
  saved: MonitoredLocation[],
  callbackPrefix: 'pq' | 'wx',
): OutgoingMessage {
  const t = tr(lang);
  // With nothing saved, the answer is the 📍 key — sent again with the
  // question, in case it was hidden.
  if (saved.length === 0) return { html: esc(text), markup: mainKeyboard(lang) };
  return {
    html: blocks(esc(text), esc(t('tg.orSaved'))),
    markup: {
      inline_keyboard: [
        saved.map((l) => ({
          text: l.placeName,
          callback_data: `${callbackPrefix}:${placeKey(l)}`,
        })),
      ],
    },
  };
}

/* ------------------------------------------------------------------ */
/* Onboarding and help                                                 */
/* ------------------------------------------------------------------ */

export type AccountState =
  | { linked: false }
  | { linked: true; alertsOn: boolean; account: string };

function examples(lang: InterfaceLang): string {
  return tr(lang)('tg.examples')
    .split('\n')
    .map((line) => i(line))
    .join('\n');
}

/**
 * The first thing the bot says. `account` null leaves out the account
 * paragraph — for someone who has just connected and was told so a moment ago.
 */
export function welcomeMessage(
  lang: InterfaceLang,
  greetingLine: string,
  account: AccountState | null,
  site = siteUrl(),
): OutgoingMessage {
  const t = tr(lang);
  const html = blocks(
    lines(b(greetingLine), esc(t('tg.tagline'))),
    lines(esc(t('tg.howToAsk')), examples(lang)),
    esc(t('tg.tapHere', { button: t('tg.kb.here') })),
    account === null
      ? null
      : account.linked
        ? esc(t(account.alertsOn ? 'tg.connectedNote' : 'tg.connectedPausedNote'))
        : lines(esc(t('tg.connectInvite')), link(connectUrl(site), t('tg.connectLink'))),
  );
  return { html, markup: mainKeyboard(lang) };
}

const COMMANDS = [
  ['weather', 'tg.cmd.weather'],
  ['locations', 'tg.cmd.locations'],
  ['alerts', 'tg.cmd.alerts'],
  ['settings', 'tg.cmd.settings'],
  ['help', 'tg.cmd.help'],
] as const;

/** The command menu, in the order and words `setMyCommands` registers. */
export function commandMenu(lang: InterfaceLang): { command: string; description: string }[] {
  return COMMANDS.map(([command, key]) => ({ command, description: translate(key, lang) }));
}

export function helpMessage(lang: InterfaceLang): OutgoingMessage {
  const t = tr(lang);
  const html = blocks(
    lines(b(t('tg.cmd.help')), examples(lang)),
    esc(t('tg.tapHere', { button: t('tg.kb.here') })),
    COMMANDS.filter(([command]) => command !== 'help')
      .map(([command, key]) => `/${command} — ${esc(t(key))}`)
      .join('\n'),
    i(t('tg.help.sources')),
  );
  return { html, markup: mainKeyboard(lang) };
}

/* ------------------------------------------------------------------ */
/* Places, alerts, settings                                            */
/* ------------------------------------------------------------------ */

function connectButton(lang: InterfaceLang, site: string): InlineButton {
  return { text: tr(lang)('tg.connectLink'), url: connectUrl(site), style: 'primary' };
}

export function placesMessage(
  lang: InterfaceLang,
  state: { linked: false } | { linked: true; locations: MonitoredLocation[]; limit: number },
  site = siteUrl(),
): OutgoingMessage {
  const t = tr(lang);
  if (!state.linked) {
    return {
      html: blocks(b(t('tg.places.title')), esc(t('tg.places.guest'))),
      markup: { inline_keyboard: [[connectButton(lang, site)]] },
    };
  }

  const heading = `${b(t('tg.places.title'))} · ${esc(t('places.count', { used: state.locations.length, limit: state.limit }))}`;
  if (state.locations.length === 0) {
    return { html: blocks(heading, esc(t('tg.places.empty'))) };
  }

  const list = state.locations
    .map((l) => {
      const where = [l.district !== l.placeName ? districtLabel(l.district, lang) : null, l.state]
        .filter(Boolean)
        .join(', ');
      return `• ${b(l.placeName)}${where ? ` · ${esc(where)}` : ''}`;
    })
    .join('\n');

  return {
    html: blocks(heading, list, esc(t('tg.places.hint'))),
    markup: {
      inline_keyboard: state.locations.map((l) => [
        { text: l.placeName, callback_data: `wx:${placeKey(l)}` },
        { text: t('tg.places.remove'), callback_data: `rm:${l.id}` },
      ]),
    },
  };
}

export function alertsMessage(
  lang: InterfaceLang,
  state: { linked: false } | { linked: true; alertsOn: boolean; places: string[] },
  site = siteUrl(),
): OutgoingMessage {
  const t = tr(lang);
  const title = b(t('tg.cmd.alerts'));

  if (!state.linked) {
    return {
      html: blocks(title, esc(t('tg.alerts.guest')), i(t('tg.alerts.what'))),
      markup: { inline_keyboard: [[connectButton(lang, site)]] },
    };
  }

  const status = !state.alertsOn
    ? `⏸ ${esc(t('tg.alerts.paused'))}`
    : state.places.length === 0
      ? `🔔 ${esc(t('tg.alerts.onEmpty'))}`
      : `🔔 ${esc(t('tg.alerts.on', { places: state.places.join(', ') }))}`;

  return {
    html: blocks(title, status, i(t('tg.alerts.what'))),
    markup: {
      inline_keyboard: [
        [
          state.alertsOn
            ? { text: t('tg.alerts.pause'), callback_data: 'al:off' }
            : { text: t('tg.alerts.resume'), callback_data: 'al:on', style: 'primary' },
          { text: t('tg.kb.places'), callback_data: 'pl' },
        ],
      ],
    },
  };
}

/** The label a preference shows in the language list: its own name. */
function languageLabel(preference: LanguagePreference, lang: InterfaceLang): string {
  if (preference === 'auto') return translate('settings.autoAssistant', lang);
  return LANGUAGES.find((l) => l.code === preference)?.native ?? preference;
}

export function settingsMessage(
  lang: InterfaceLang,
  state:
    | { linked: false }
    | { linked: true; account: string; assistant: LanguagePreference },
  site = siteUrl(),
): OutgoingMessage {
  const t = tr(lang);
  const title = b(t('settings.title'));

  if (!state.linked) {
    return {
      html: blocks(title, esc(t('tg.settings.noAccount')), esc(t('tg.settings.languageGuest'))),
      markup: { inline_keyboard: [[connectButton(lang, site)]] },
    };
  }

  const current = state.assistant;
  const choices: LanguagePreference[] = ['auto', ...LANGUAGES.map((l) => l.code as LanguageCode)];
  const buttons: InlineButton[] = choices.map((choice) => ({
    text: `${choice === current ? '✓ ' : ''}${languageLabel(choice, lang)}`,
    callback_data: `lg:${choice}`,
  }));

  const rows: InlineButton[][] = [];
  for (let n = 0; n < buttons.length; n += 4) rows.push(buttons.slice(n, n + 4));
  rows.push([{ text: t('tg.unlink.button'), callback_data: 'ul:ask', style: 'danger' }]);

  return {
    html: blocks(
      title,
      esc(t('tg.settings.account', { account: state.account })),
      lines(
        esc(t('tg.settings.language', { language: languageLabel(current, lang) })),
        i(current === 'auto' ? t('settings.assistantHint') : t('tg.settings.languageShared')),
      ),
    ),
    markup: { inline_keyboard: rows },
  };
}

export function unlinkConfirmMessage(lang: InterfaceLang): OutgoingMessage {
  const t = tr(lang);
  return {
    html: esc(t('tg.unlink.confirm')),
    markup: {
      inline_keyboard: [
        [
          { text: t('confirm.cancel'), callback_data: 'ul:no' },
          { text: t('confirm.telegram.confirm'), callback_data: 'ul:yes', style: 'danger' },
        ],
      ],
    },
  };
}

export function linkConfirmMessage(
  lang: InterfaceLang,
  account: string,
  tokenId: string,
): OutgoingMessage {
  const t = tr(lang);
  return {
    html: blocks(b(t('tg.link.confirm', { account })), esc(t('tg.link.confirmBody'))),
    markup: {
      inline_keyboard: [
        [
          { text: t('confirm.cancel'), callback_data: `lx:${tokenId}` },
          { text: t('tg.link.connect'), callback_data: `lk:${tokenId}`, style: 'primary' },
        ],
      ],
    },
  };
}

/** Plain text, escaped, with nothing under it. */
export function note(text: string, markup?: InlineKeyboard): OutgoingMessage {
  return { html: esc(text), ...(markup ? { markup } : {}) };
}

/* ------------------------------------------------------------------ */
/* An alert                                                            */
/* ------------------------------------------------------------------ */

/**
 * An IMD warning, as it arrives unasked.
 *
 * Built from the alert catalogue's parts and nothing else, so it says exactly
 * what the push notification says, in the same words. It opens with the
 * severity and "Official IMD warning" so it can never be mistaken for the
 * model weather the bot talks about the rest of the time.
 *
 * An all-clear is delivered silently. A warning should wake someone; the
 * news that one has lifted should be there when they look.
 */
export function alertMessage(alert: RenderedAlert, site = siteUrl()): OutgoingMessage {
  const { parts, lang } = alert;
  const t = tr(lang);

  const details = `ad:${parts.district}`;
  // Telegram limits callback data to 64 bytes. A district that would not fit
  // loses the button, never the alert.
  const detailsButton: InlineButton[] =
    Buffer.byteLength(details, 'utf8') <= 64
      ? [{ text: t('tg.btn.details'), callback_data: details }]
      : [];

  const markup: InlineKeyboard = {
    inline_keyboard: [[...detailsButton, { text: t('tg.btn.open'), url: site }]],
  };

  if (parts.kind === 'allClear') {
    return {
      html: blocks(
        `${SEVERITY_MARK.none} ${b(alert.title)} · IMD`,
        esc(parts.lifted ?? alert.body),
        i(`${parts.source} · ${parts.issued}`),
      ),
      markup,
      silent: true,
    };
  }

  return {
    html: blocks(
      lines(
        `${SEVERITY_MARK[parts.severity]} ${b(parts.severityWords)} · ${esc(t('tg.alert.official'))}`,
        b(parts.hazard),
        esc(`${parts.district} · ${t('tg.alert.until', { time: parts.until ?? '' })}`),
      ),
      b(`${parts.action}${lang === 'hi' ? '।' : '.'}`),
      i(`${parts.source} · ${t('provenance.bulletin')} · ${t('provenance.issued')} ${parts.issued}`),
    ),
    markup,
  };
}

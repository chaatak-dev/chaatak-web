/**
 * The floor: what ships when the model is out or the gate rejects it.
 *
 * Built from the SAME facts the model was shown, so every number here is one
 * the gate would have allowed — and a test holds every template to exactly
 * that. Written by hand in Hindi, English and Hinglish; never translated by a
 * machine, and never re-wording a severity, which comes from the alert
 * catalogue verbatim and always comes first.
 *
 * PLAN-AWARE, because the template used to be one sentence — "It is 31 °C
 * right now" — whatever was asked. A gate rejection on "when did it last
 * rain?" therefore answered with the present temperature: the right number
 * for the wrong question, which is the failure this whole pass is about.
 */

import { severityAction, severityWords } from '../alerts/templates';
import type { TemplateLang } from '../i18n/detect';
import type { WeatherPlan } from '../chat/understand';
import type {
  CurrentFacts,
  HistoryFacts,
  OutlookDayFacts,
  OutlookFacts,
  SpellFacts,
  TurnFacts,
} from '../chat/turn-facts';
import type { Severity } from '../weather/types';

type L = TemplateLang;

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

/** "31.2°C", "70%", "12 km/h" — the value and its unit, untouched. */
export function withUnit(value: number, unit: string): string {
  return /^[%°]/.test(unit) ? `${value}${unit}` : `${value} ${unit}`;
}

const HI_MONTHS: Record<string, string> = {
  Jan: 'जनवरी', Feb: 'फ़रवरी', Mar: 'मार्च', Apr: 'अप्रैल', May: 'मई', Jun: 'जून',
  Jul: 'जुलाई', Aug: 'अगस्त', Sep: 'सितंबर', Oct: 'अक्टूबर', Nov: 'नवंबर', Dec: 'दिसंबर',
};

/** "24 Sep" as each register writes it. The digits are the same digits. */
function date(short: string, lang: L): string {
  if (lang !== 'hi') return short;
  const [day, month] = short.split(' ');
  return HI_MONTHS[month] ? `${day} ${HI_MONTHS[month]}` : short;
}

const HI_WEEKDAYS: Record<string, [string, string]> = {
  Monday: ['सोमवार', 'Somvar'],
  Tuesday: ['मंगलवार', 'Mangalvar'],
  Wednesday: ['बुधवार', 'Budhvar'],
  Thursday: ['गुरुवार', 'Guruvar'],
  Friday: ['शुक्रवार', 'Shukravar'],
  Saturday: ['शनिवार', 'Shanivar'],
  Sunday: ['रविवार', 'Ravivar'],
};

/** "tomorrow" / "कल" / "kal", from the English label the facts carry. */
function label(english: string, lang: L): string {
  if (lang === 'en') return english;
  const table: Record<string, [string, string]> = {
    today: ['आज', 'aaj'],
    tomorrow: ['कल', 'kal'],
    yesterday: ['कल', 'kal'],
    'day after tomorrow': ['परसों', 'parson'],
    'day before yesterday': ['परसों', 'parson'],
    ...HI_WEEKDAYS,
  };
  const found = table[english];
  if (!found) return english;
  return lang === 'hi' ? found[0] : found[1];
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Sentences joined in the register's own punctuation. */
function sentences(parts: (string | null | undefined | false)[], lang: L): string {
  const stop = lang === 'hi' ? '।' : '.';
  return parts
    .filter((p): p is string => Boolean(p && p.trim()))
    .map((p) => {
      const t = p.trim();
      return /[।.!?)]$/u.test(t) ? t : `${t}${stop}`;
    })
    .join(' ');
}

/** Severity first, in the catalogue's words. Hinglish reads the English taxonomy. */
export function severityLead(severity: Severity | 'unknown', lang: L): string | null {
  if (severity === 'unknown' || severity === 'none') return null;
  const taxonomy = lang === 'hi' ? 'hi' : 'en';
  const stop = lang === 'hi' ? '।' : '.';
  return `${severityWords(severity, taxonomy)}${stop} ${severityAction(severity, taxonomy)}${stop}`;
}

/**
 * The first words of a correction: "Got it — not Kanpur." The answer that
 * follows names the new place, so this does not name it twice.
 */
function correctionLead(plan: WeatherPlan, lang: L): string | null {
  if (plan.turn !== 'correction') return null;
  if (plan.rejected) {
    if (lang === 'hi') return `ठीक है — ${plan.rejected} नहीं।`;
    if (lang === 'hinglish') return `Theek hai — ${plan.rejected} nahi.`;
    return `Got it — not ${plan.rejected}.`;
  }
  if (lang === 'hi') return 'ठीक है।';
  if (lang === 'hinglish') return 'Theek hai.';
  return 'Got it.';
}

/* ------------------------------------------------------------------ */
/* Now                                                                 */
/* ------------------------------------------------------------------ */

function measurement(current: CurrentFacts, key: string): string | null {
  const m = current.measurements.find((x) => x.key === key);
  return m ? withUnit(m.value, m.unit) : null;
}

function todayOf(outlook: TurnFacts['outlook']): OutlookDayFacts | null {
  if (!outlook || 'unavailable' in outlook) return null;
  return outlook.days.find((d) => d.label === 'today') ?? null;
}

function currentText(facts: TurnFacts, plan: WeatherPlan, place: string, lang: L): string {
  const current = facts.current;
  if (!current || 'unavailable' in current) {
    const said = current && 'unavailable' in current ? current.unavailable : null;
    if (lang === 'hinglish') return 'Is samay ka aankda uplabdh nahi hai.';
    return said ?? (lang === 'hi' ? 'इस समय का आँकड़ा उपलब्ध नहीं है।' : 'No current reading is available.');
  }

  const temp = measurement(current, 'temperature');
  const feels = measurement(current, 'apparentTemperature');
  const humidity = measurement(current, 'humidity');
  const wind = measurement(current, 'windSpeed');
  const rain = measurement(current, 'precipitation');
  const condition = current.condition;
  const today = todayOf(facts.outlook);
  const units = facts.outlook && !('unavailable' in facts.outlook) ? facts.outlook.units : null;
  const high = today?.maxTemp != null && units ? withUnit(today.maxTemp, units.temperature) : null;
  const low = today?.minTemp != null && units ? withUnit(today.minTemp, units.temperature) : null;
  const daySum = today?.precipitationSum != null && units ? withUnit(today.precipitationSum, units.precipitation) : null;
  const chance =
    today?.precipitationProbability != null && units?.probability
      ? withUnit(today.precipitationProbability, units.probability)
      : null;

  switch (plan.variable) {
    case 'temperature':
      if (lang === 'hi')
        return sentences([
          temp && `${place} में अभी तापमान ${temp} है${feels ? `, महसूस ${feels} होता है` : ''}`,
          high && low && `आज अधिकतम ${high}, न्यूनतम ${low}`,
        ], lang);
      if (lang === 'hinglish')
        return sentences([
          temp && `${place} mein abhi temperature ${temp} hai${feels ? `, mehsoos ${feels}` : ''}`,
          high && low && `Aaj max ${high}, min ${low}`,
        ], lang);
      return sentences([
        temp && `It is ${temp} in ${place} right now${feels ? `, and it feels like ${feels}` : ''}`,
        high && low && `Today: high ${high}, low ${low}`,
      ], lang);

    case 'rain':
      if (lang === 'hi')
        return sentences([
          condition && `${place}: ${condition}`,
          rain && `अभी बारिश: ${rain}`,
          daySum && `आज कुल ${daySum} बारिश का अनुमान है${chance ? `, संभावना ${chance}` : ''}`,
        ], lang);
      if (lang === 'hinglish')
        return sentences([
          condition && `${place}: ${condition}`,
          rain && `Abhi baarish: ${rain}`,
          daySum && `Aaj kul ${daySum} baarish ka anumaan hai${chance ? `, sambhavna ${chance}` : ''}`,
        ], lang);
      return sentences([
        condition && `${place}: ${condition}`,
        rain && `Precipitation right now: ${rain}`,
        daySum && `The forecast for today is ${daySum} in total${chance ? `, with a ${chance} chance of rain` : ''}`,
      ], lang);

    case 'wind':
      if (lang === 'hi') return sentences([wind ? `${place} में अभी हवा की रफ़्तार ${wind} है` : null], lang) || currentAll();
      if (lang === 'hinglish') return sentences([wind ? `${place} mein abhi hawa ki raftaar ${wind} hai` : null], lang) || currentAll();
      return sentences([wind ? `The wind in ${place} is ${wind} right now` : null], lang) || currentAll();

    case 'humidity':
      if (lang === 'hi') return sentences([humidity ? `${place} में अभी नमी ${humidity} है` : null], lang) || currentAll();
      if (lang === 'hinglish') return sentences([humidity ? `${place} mein abhi nami ${humidity} hai` : null], lang) || currentAll();
      return sentences([humidity ? `Humidity in ${place} is ${humidity} right now` : null], lang) || currentAll();

    default:
      return currentAll();
  }

  function currentAll(): string {
    const rest = (h: string, w: string) =>
      (humidity || wind) &&
      capitalise([humidity && `${h} ${humidity}`, wind && `${w} ${wind}`].filter(Boolean).join(', '));
    if (lang === 'hi')
      return sentences([
        condition && `${place}: ${condition}`,
        temp && `अभी तापमान ${temp} है${feels ? `, महसूस ${feels}` : ''}`,
        rest('नमी', 'हवा'),
      ], lang);
    if (lang === 'hinglish')
      return sentences([
        condition && `${place}: ${condition}`,
        temp && `Abhi temperature ${temp} hai${feels ? `, mehsoos ${feels}` : ''}`,
        rest('nami', 'hawa'),
      ], lang);
    return sentences([
      condition && `${place}: ${condition}`,
      temp && `It is ${temp} right now${feels ? `, feels like ${feels}` : ''}`,
      rest('humidity', 'wind'),
    ], lang);
  }
}

/* ------------------------------------------------------------------ */
/* Ahead                                                               */
/* ------------------------------------------------------------------ */

function dayLine(day: OutlookDayFacts, units: OutlookFacts['units'], plan: WeatherPlan, place: string, lang: L): string {
  const high = day.maxTemp != null ? withUnit(day.maxTemp, units.temperature) : null;
  const low = day.minTemp != null ? withUnit(day.minTemp, units.temperature) : null;
  const rain = day.precipitationSum != null ? withUnit(day.precipitationSum, units.precipitation) : null;
  const chance =
    day.precipitationProbability != null && units.probability ? withUnit(day.precipitationProbability, units.probability) : null;
  const wind = day.maxWind != null && units.wind ? withUnit(day.maxWind, units.wind) : null;
  const when = `${label(day.label, lang)} (${date(day.date, lang)})`;

  const hi = lang === 'hi';
  const hl = lang === 'hinglish';
  const pieces: (string | null)[] = [];
  const v = plan.variable;

  if (v === 'all' || v === 'rain') pieces.push(day.condition);
  if (v === 'all' || v === 'temperature') {
    if (high) pieces.push(hi ? `अधिकतम ${high}` : hl ? `max ${high}` : `high ${high}`);
    if (low) pieces.push(hi ? `न्यूनतम ${low}` : hl ? `min ${low}` : `low ${low}`);
  }
  if (v === 'all' || v === 'rain') {
    if (rain) pieces.push(hi ? `बारिश ${rain}` : hl ? `baarish ${rain}` : `rain ${rain}`);
    if (chance) pieces.push(hi ? `बारिश की संभावना ${chance}` : hl ? `baarish ki sambhavna ${chance}` : `${chance} chance of rain`);
  }
  if (v === 'all' || v === 'wind') {
    if (wind) pieces.push(hi ? `हवा ${wind} तक` : hl ? `hawa ${wind} tak` : `wind up to ${wind}`);
  }
  if (v === 'humidity') {
    pieces.push(
      hi ? 'पूर्वानुमान में नमी शामिल नहीं है' : hl ? 'forecast mein nami shaamil nahi hai' : 'the forecast does not include humidity',
    );
  }

  const body = pieces.filter(Boolean).join(', ');
  if (!body) return hi ? `${when}: जानकारी उपलब्ध नहीं है` : hl ? `${when}: jaankari uplabdh nahi hai` : `${when}: not available`;
  return hi ? `${when} ${place} में: ${body}` : hl ? `${capitalise(when)} ${place} mein: ${body}` : `${capitalise(when)} in ${place}: ${body}`;
}

function forecastText(facts: TurnFacts, plan: WeatherPlan, place: string, lang: L): string {
  const outlook = facts.outlook;
  if (!outlook || 'unavailable' in outlook) {
    if (lang === 'hinglish') return 'Forecast abhi uplabdh nahi hai.';
    return outlook && 'unavailable' in outlook ? outlook.unavailable : lang === 'hi' ? 'पूर्वानुमान उपलब्ध नहीं है।' : 'The forecast is not available.';
  }

  const focus = new Set(facts.focusDays ?? []);
  const days = outlook.days.filter((d) => focus.has(d.date));

  if (days.length === 0) {
    // The count is said only when the facts carry it — a number that is not
    // in the facts is one the gate would refuse from the model, and the
    // floor is held to the same rule.
    const n = facts.horizonDays;
    if (n === undefined) {
      if (lang === 'hi') return 'पूर्वानुमान अभी उस दिन तक नहीं पहुँचता।';
      if (lang === 'hinglish') return 'Forecast abhi us din tak nahi pahunchta.';
      return 'The forecast does not reach that day yet.';
    }
    if (lang === 'hi') return `पूर्वानुमान अभी सिर्फ़ ${n} दिन आगे तक है, इसलिए उस दिन का अभी नहीं बता सकता।`;
    if (lang === 'hinglish') return `Forecast abhi sirf ${n} din aage tak hai, isliye us din ka abhi nahi bata sakta.`;
    return `The forecast only reaches ${n} days ahead, so I cannot say for that day yet.`;
  }

  return sentences(days.map((d) => dayLine(d, outlook.units, plan, place, lang)), lang);
}

/* ------------------------------------------------------------------ */
/* Warnings                                                            */
/* ------------------------------------------------------------------ */

function warningText(facts: TurnFacts, place: string, lang: L): string {
  const warnings = facts.warnings;
  if ('unavailable' in warnings) {
    if (lang === 'hinglish') return 'IMD ki chetavaniyan abhi uplabdh nahi hain.';
    return warnings.unavailable;
  }
  if (warnings.inForce.length === 0) {
    if (lang === 'hi') return `IMD ने ${place} के लिए अभी कोई चेतावनी जारी नहीं की है।`;
    if (lang === 'hinglish') return `IMD ne ${place} ke liye abhi koi chetavani jaari nahi ki hai.`;
    return `IMD lists no warning in force for ${place} right now.`;
  }
  const taxonomy = lang === 'hi' ? 'hi' : 'en';
  const lines = warnings.inForce.slice(0, 3).map((w) => {
    const words = severityWords(w.severity as Severity, taxonomy);
    const hazards = w.hazards.join(', ');
    return `${words}${hazards ? ` — ${hazards}` : ''} (${w.when})`;
  });
  if (lang === 'hi') return `IMD की चेतावनी: ${lines.join('; ')}।`;
  if (lang === 'hinglish') return `IMD ki chetavani: ${lines.join('; ')}.`;
  return `IMD warnings in force: ${lines.join('; ')}.`;
}

/* ------------------------------------------------------------------ */
/* The past                                                            */
/* ------------------------------------------------------------------ */

function ago(spell: SpellFacts, lang: L): string {
  if (spell.hoursAgo !== undefined && spell.daysAgo <= 1) {
    if (spell.hoursAgo <= 1) return lang === 'hi' ? 'अभी हाल में' : lang === 'hinglish' ? 'abhi haal mein' : 'within the last hour';
    return lang === 'hi' ? `${spell.hoursAgo} घंटे पहले` : lang === 'hinglish' ? `${spell.hoursAgo} ghante pehle` : `${spell.hoursAgo} hours ago`;
  }
  if (spell.daysAgo === 0) return lang === 'hi' ? 'आज' : lang === 'hinglish' ? 'aaj' : 'today';
  if (spell.daysAgo === 1) return lang === 'hi' ? 'कल' : lang === 'hinglish' ? 'kal' : 'yesterday';
  return lang === 'hi' ? `${spell.daysAgo} दिन पहले` : lang === 'hinglish' ? `${spell.daysAgo} din pehle` : `${spell.daysAgo} days ago`;
}

function natureNote(facts: TurnFacts, lang: L): string {
  const reanalysis = facts.historyNature?.startsWith('reanalysis') ?? false;
  if (lang === 'hi') return reanalysis ? '(यह मॉडल का पुनर्विश्लेषण है, वर्षामापी का आँकड़ा नहीं।)' : '(यह Open-Meteo मॉडल का रिकॉर्ड है, वर्षामापी का आँकड़ा नहीं।)';
  if (lang === 'hinglish') return reanalysis ? '(Yeh model ka reanalysis hai, rain gauge ka aankda nahi.)' : '(Yeh Open-Meteo model ka record hai, rain gauge ka aankda nahi.)';
  return reanalysis ? '(A modelled reanalysis, not a rain-gauge reading.)' : '(From the Open-Meteo model record, not a rain gauge.)';
}

function historyText(facts: TurnFacts, plan: WeatherPlan, place: string, lang: L): string {
  const history = facts.history;
  if (!history || 'unavailable' in history) {
    if (lang === 'hinglish') return 'Is samay ka record uplabdh nahi hai.';
    return history && 'unavailable' in history
      ? history.unavailable
      : lang === 'hi'
        ? 'इस समय का रिकॉर्ड उपलब्ध नहीं है।'
        : 'No record is available for that time.';
  }

  const body = historyBody(history, plan, place, lang);
  return sentences([body, natureNote(facts, lang)], lang);
}

function historyBody(h: HistoryFacts, plan: WeatherPlan, place: string, lang: L): string {
  const hi = lang === 'hi';
  const hl = lang === 'hinglish';

  switch (h.kind) {
    case 'lastRain': {
      const before = plan.window.kind === 'lastEvent' && plan.window.before;
      if (h.lastRain) {
        const e = h.lastRain;
        const total = withUnit(e.total, h.unit);
        const when = `${date(e.day, lang)}`;
        // "Before that, it rained on 17 Sep" — not "before that, the last
        // rain was", which contradicts itself.
        const main = before
          ? hi
            ? `उससे पहले, ${place} में ${when} को बारिश हुई थी (${ago(e, lang)}): ${e.started} से ${e.ended} के बीच कुल ${total}`
            : hl
              ? `Usse pehle, ${place} mein ${when} ko baarish hui thi (${ago(e, lang)}): ${e.started} se ${e.ended} ke beech kul ${total}`
              : `Before that, it rained in ${place} on ${when} (${ago(e, lang)}): ${total} between ${e.started} and ${e.ended}`
          : hi
            ? `${place} में आखिरी बारिश ${when} को हुई थी (${ago(e, lang)}): ${e.started} से ${e.ended} के बीच कुल ${total}`
            : hl
              ? `${place} mein aakhri baarish ${when} ko hui thi (${ago(e, lang)}): ${e.started} se ${e.ended} ke beech kul ${total}`
              : `The last rain in ${place} was on ${when} (${ago(e, lang)}): ${total} between ${e.started} and ${e.ended}`;
        const still = e.ongoing ? (hi ? 'बारिश अभी भी जारी है' : hl ? 'Baarish abhi bhi jaari hai' : 'It is still raining') : null;
        const trace = h.onlyTraceSince
          ? hi
            ? `तब से सिर्फ़ ${date(h.onlyTraceSince.day, lang)} को ${withUnit(h.onlyTraceSince.total, h.unit)} की हल्की बूंदाबांदी हुई`
            : hl
              ? `Tab se sirf ${h.onlyTraceSince.day} ko ${withUnit(h.onlyTraceSince.total, h.unit)} ki halki boondabaandi hui`
              : `Since then, only a trace: ${withUnit(h.onlyTraceSince.total, h.unit)} on ${h.onlyTraceSince.day}`
          : null;
        return sentences([main, still, trace], lang);
      }
      const threshold = withUnit(h.rainThresholdMm, h.unit);
      const none = hi
        ? `पिछले ${h.searchedDays} दिनों में ${place} में ${threshold} या उससे ज़्यादा बारिश नहीं हुई`
        : hl
          ? `Pichhle ${h.searchedDays} dinon mein ${place} mein ${threshold} ya usse zyada baarish nahi hui`
          : `There has been no rain of ${threshold} or more in ${place} in the last ${h.searchedDays} days`;
      const trace = h.onlyTraceSince
        ? hi
          ? `सिर्फ़ ${date(h.onlyTraceSince.day, lang)} को ${withUnit(h.onlyTraceSince.total, h.unit)} की हल्की बूंदाबांदी हुई`
          : hl
            ? `Sirf ${h.onlyTraceSince.day} ko ${withUnit(h.onlyTraceSince.total, h.unit)} ki halki boondabaandi hui`
            : `Only a trace: ${withUnit(h.onlyTraceSince.total, h.unit)} on ${h.onlyTraceSince.day}`
        : null;
      return sentences([none, trace], lang);
    }

    case 'day': {
      const when = `${label(h.label, lang)} (${date(h.date, lang)})`;
      if (h.soFar) {
        const total = withUnit(h.soFar.total, h.units.precipitation);
        return hi
          ? `आज ${place} में ${h.soFar.since} से ${h.soFar.through} तक ${total} बारिश हुई है`
          : hl
            ? `Aaj ${place} mein ${h.soFar.since} se ${h.soFar.through} tak ${total} baarish hui hai`
            : `So far today in ${place} (${h.soFar.since} to ${h.soFar.through}): ${total} of rain`;
      }
      const rain = h.rain != null ? withUnit(h.rain, h.units.precipitation) : null;
      const high = h.maxTemp != null ? withUnit(h.maxTemp, h.units.temperature) : null;
      const low = h.minTemp != null ? withUnit(h.minTemp, h.units.temperature) : null;
      const wind = h.maxWind != null && h.units.wind ? withUnit(h.maxWind, h.units.wind) : null;
      const v = plan.variable;

      if (!rain && !high && !low) {
        return hi ? `${when} का रिकॉर्ड उपलब्ध नहीं है` : hl ? `${capitalise(when)} ka record uplabdh nahi hai` : `There is no record for ${when}`;
      }

      const pieces: (string | null)[] = [];
      if (v === 'all' || v === 'rain') pieces.push(h.condition);
      if (v === 'all' || v === 'rain' || v === 'humidity') {
        if (rain) pieces.push(hi ? `बारिश ${rain}` : hl ? `baarish ${rain}` : `rain ${rain}`);
      }
      if (v === 'all' || v === 'temperature') {
        if (high) pieces.push(hi ? `अधिकतम ${high}` : hl ? `max ${high}` : `high ${high}`);
        if (low) pieces.push(hi ? `न्यूनतम ${low}` : hl ? `min ${low}` : `low ${low}`);
      }
      if ((v === 'all' || v === 'wind') && wind) pieces.push(hi ? `हवा ${wind} तक` : hl ? `hawa ${wind} tak` : `wind up to ${wind}`);

      const spell = (v === 'all' || v === 'rain') && h.spells.length > 0 ? h.spells[h.spells.length - 1] : null;
      const spellLine = spell
        ? hi
          ? `ज़्यादातर बारिश ${spell.started} से ${spell.ended} के बीच हुई`
          : hl
            ? `Zyadatar baarish ${spell.started} se ${spell.ended} ke beech hui`
            : `Most of it fell between ${spell.started} and ${spell.ended}`
        : null;

      const main = hi
        ? `${when} ${place} में: ${pieces.filter(Boolean).join(', ')}`
        : hl
          ? `${capitalise(when)} ${place} mein: ${pieces.filter(Boolean).join(', ')}`
          : `${capitalise(when)} in ${place}: ${pieces.filter(Boolean).join(', ')}`;
      return sentences([main, spellLine], lang);
    }

    case 'days': {
      const span = `${date(h.from, lang)} – ${date(h.to, lang)}`;
      const total = h.total != null ? withUnit(h.total, h.units.precipitation) : null;
      const hot = h.hottest ? withUnit(h.hottest.value, h.units.temperature) : null;
      const cool = h.coolest ? withUnit(h.coolest.value, h.units.temperature) : null;
      const v = plan.variable;

      const rainLine =
        v === 'temperature'
          ? null
          : total
            ? hi
              ? `पिछले ${h.days} दिनों (${span}) में ${place} में कुल ${total} बारिश हुई, ${h.wetDays} दिन बारिश वाले रहे`
              : hl
                ? `Pichhle ${h.days} dinon (${span}) mein ${place} mein kul ${total} baarish hui, ${h.wetDays} din baarish wale rahe`
                : `In the last ${h.days} days (${span}), ${place} had ${total} of rain, with ${h.wetDays} rainy ${h.wetDays === 1 ? 'day' : 'days'}`
            : hi
              ? `पिछले ${h.days} दिनों (${span}) का रिकॉर्ड अधूरा है, इसलिए कुल बारिश नहीं बता सकता`
              : hl
                ? `Pichhle ${h.days} dinon (${span}) ka record adhoora hai, isliye kul baarish nahi bata sakta`
                : `The record for the last ${h.days} days (${span}) is incomplete, so I cannot give a total`;
      const tempLine =
        (v === 'temperature' || v === 'all') && hot && cool && h.hottest && h.coolest
          ? hi
            ? `सबसे ज़्यादा ${hot} (${date(h.hottest.date, lang)}), सबसे कम ${cool} (${date(h.coolest.date, lang)})`
            : hl
              ? `Sabse zyada ${hot} (${h.hottest.date}), sabse kam ${cool} (${h.coolest.date})`
              : `Highest ${hot} on ${h.hottest.date}, lowest ${cool} on ${h.coolest.date}`
          : null;
      return sentences([rainLine, tempLine], lang);
    }

    case 'hours': {
      const total = withUnit(h.total, h.unit);
      if (h.total === 0) {
        return hi
          ? `पिछले ${h.hours} घंटों में ${place} में बारिश नहीं हुई`
          : hl
            ? `Pichhle ${h.hours} ghanton mein ${place} mein baarish nahi hui`
            : `No rain in ${place} in the last ${h.hours} hours`;
      }
      return hi
        ? `पिछले ${h.hours} घंटों में ${place} में ${total} बारिश हुई (${h.wetHours} घंटे बारिश वाले)`
        : hl
          ? `Pichhle ${h.hours} ghanton mein ${place} mein ${total} baarish hui (${h.wetHours} ghante baarish wale)`
          : `In the last ${h.hours} hours, ${place} had ${total} of rain over ${h.wetHours} wet hours`;
    }
  }
}

/* ------------------------------------------------------------------ */
/* The template                                                        */
/* ------------------------------------------------------------------ */

export type TemplateInput = {
  plan: WeatherPlan;
  facts: TurnFacts;
  lang: L;
  /** The place as this register names it. */
  place: string;
  /** The loudest severity in force; anything louder than none leads. */
  severity: Severity | 'unknown';
};

/**
 * The answer a plan gets when the model's does not ship. Severity first,
 * then a correction's acknowledgement, then exactly what was asked.
 */
export function weatherTemplate(input: TemplateInput): string {
  const { plan, facts, lang, place, severity } = input;
  const lead = severityLead(severity, lang);
  const corrected = correctionLead(plan, lang);

  let body: string;
  switch (plan.intent) {
    case 'history':
      body = historyText(facts, plan, place, lang);
      break;
    case 'forecast':
      body = forecastText(facts, plan, place, lang);
      break;
    case 'warning':
      body = warningText(facts, place, lang);
      break;
    default:
      body = currentText(facts, plan, place, lang);
  }

  // A warning in force is also said in words on a question that did not ask
  // about warnings — the severity lead names it, this names what it is for.
  const alsoWarn =
    plan.intent !== 'warning' && lead && !('unavailable' in facts.warnings) && facts.warnings.inForce.length > 0
      ? warningText(facts, place, lang)
      : null;

  return [lead, corrected, body, alsoWarn].filter(Boolean).join(' ');
}

/* ------------------------------------------------------------------ */
/* The fixed lines                                                     */
/* ------------------------------------------------------------------ */

/** The place could not be found — in the register, quoting what was typed. */
export function unknownPlace(query: string, lang: L, statement: { hi: string; en: string }): string {
  if (lang === 'hinglish') return `"${query}" naam ki koi jagah nahi mili. Spelling dekhiye, ya paas ke kisi shehar ka naam likhiye.`;
  return statement[lang];
}

/** "Okay — Hindi from now on", in the language asked for. */
export function languageAck(lang: L, native: string): string {
  if (lang === 'hi') return 'ठीक है, अब से हिंदी में जवाब दूँगा।';
  if (lang === 'hinglish') return 'Theek hai, ab se Hinglish mein jawab dunga.';
  return native === 'English' ? 'Okay — I will reply in English from now on.' : `Okay — replies in ${native} from now on.`;
}

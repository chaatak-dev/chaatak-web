'use client';

/**
 * Historical climate analysis: the controls, and the states around a result.
 *
 * Nothing is fetched until someone asks. The page opens on its controls and
 * an empty state; the archive is read when Analyse is pressed, or when the
 * page is opened from a shared link that already names a place. The results
 * and every chart are a separate chunk, loaded only once there is something
 * to draw — the conversation page never downloads any of it.
 *
 * Renders in the interface language, read from the same stores as the rest
 * of Chaatak, exactly as the FAQ does.
 */

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import {
  BASELINES,
  FIRST_YEAR,
  MAX_PARAMS,
  PARAM_GROUPS,
  PRESETS,
  PRESET_KEYS,
  SEASON_KEYS,
  defaultQuery,
  lastCompleteYear,
  readQuery,
  writeQuery,
  type BaselineKey,
  type ClimateParam,
  type ClimateQuery,
  type PresetKey,
} from '@/lib/climate/params';
import type { ClimateResponse } from '@/lib/climate/types';
import { bcp47 } from '@/lib/i18n/languages';
import { deviceLanguages, languagesSnapshot, serverLanguagesSnapshot, subscribeLanguages } from '@/lib/i18n/local';
import { resolveLanguages } from '@/lib/i18n/preferences';
import { translator, type StringKey, type Translate } from '@/lib/i18n/strings';
import { LogoMark } from '../components/LogoMark';

const ClimateResults = dynamic(() => import('./ClimateResults').then((m) => m.ClimateResults), {
  ssr: false,
  loading: () => <ResultsSkeleton />,
});

const noopSubscribe = () => () => {};

type Draft = Omit<ClimateQuery, 'place'>;

type Status =
  | { kind: 'idle' }
  | { kind: 'loading'; years: number }
  | { kind: 'done'; response: ClimateResponse }
  | { kind: 'problem'; problem: string }
  | { kind: 'offline' };

const EXAMPLES: Record<'hi' | 'en', string[]> = {
  en: ['Jaipur', 'Pune', 'Barabanki'],
  hi: ['जयपुर', 'पुणे', 'बाराबंकी'],
};

function BackArrow() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M10 3.5L5.5 8l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ClimateView() {
  const preferences = useSyncExternalStore(subscribeLanguages, languagesSnapshot, serverLanguagesSnapshot);
  const device = useSyncExternalStore(noopSubscribe, deviceLanguages, () => undefined);
  const lang = useMemo(() => resolveLanguages(preferences, device).ui, [preferences, device]);
  const t = useMemo(() => translator(lang), [lang]);

  useEffect(() => {
    document.documentElement.lang = bcp47(lang);
  }, [lang]);

  const last = useMemo(() => lastCompleteYear(), []);
  const [place, setPlace] = useState('');
  const [draft, setDraft] = useState<Draft>(() => defaultQuery());
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  const inFlight = useRef<{ key: string; controller: AbortController } | null>(null);
  const shown = useRef<string | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  const run = useCallback(
    async (query: ClimateQuery) => {
      const search = writeQuery(query);
      const key = search.toString();
      // The same question already answered, or already on its way: no request.
      if (key === shown.current && status.kind === 'done') return;
      if (inFlight.current?.key === key) return;
      inFlight.current?.controller.abort();

      const controller = new AbortController();
      inFlight.current = { key, controller };
      const years = Math.max(query.to, query.baselineTo) - Math.min(query.from, query.baselineFrom) + 1;
      setStatus({ kind: 'loading', years });
      window.history.replaceState(null, '', `/climate?${key}`);

      try {
        const res = await fetch(`/api/climate?${key}`, { signal: controller.signal });
        const body = (await res.json()) as ClimateResponse;
        shown.current = key;
        setStatus({ kind: 'done', response: body });
      } catch (error) {
        if ((error as Error).name === 'AbortError') return;
        setStatus({ kind: 'offline' });
      } finally {
        if (inFlight.current?.controller === controller) inFlight.current = null;
      }
    },
    [status.kind],
  );

  const submit = useCallback(
    (placeText: string, next: Draft) => {
      const read = readQuery(writeQuery({ ...next, place: placeText }));
      if (!read.ok) {
        setStatus({ kind: 'problem', problem: read.problem });
        return;
      }
      void run(read.query);
    },
    [run],
  );

  // A shared link that already names a place is a request: answer it once.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    const search = new URLSearchParams(window.location.search);
    if (!search.get('place')) return;
    const read = readQuery(search);
    if (!read.ok) return;
    const { place: p, ...rest } = read.query;
    // Adopting state from the URL is the point of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPlace(p);
    setDraft(rest);
    void run(read.query);
  }, [run]);

  useEffect(() => {
    if (status.kind === 'done' && status.response.kind === 'analysis') {
      // The controls fill a phone's screen; the answer is below them.
      resultsRef.current?.focus({ preventScroll: true });
      resultsRef.current?.scrollIntoView({ block: 'start' });
    }
  }, [status]);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    submit(place, draft);
  };

  const choosePreset = (key: PresetKey) => {
    const preset = PRESETS[key];
    setDraft((d) => ({
      ...d,
      preset: key,
      params: key === 'custom' ? d.params : [...preset.params],
      resolution: preset.resolution,
      season: preset.season,
    }));
  };

  const toggleParam = (param: ClimateParam) => {
    setDraft((d) => {
      const has = d.params.includes(param);
      const params = has ? d.params.filter((p) => p !== param) : [...d.params, param];
      if (params.length > MAX_PARAMS) return d;
      return { ...d, params, preset: 'custom' };
    });
  };

  const setBaseline = (value: BaselineKey) => {
    setDraft((d) => {
      if (value === 'custom') return { ...d, baseline: 'custom' };
      const [from, to] = BASELINES[value];
      return { ...d, baseline: value, baselineFrom: from, baselineTo: to };
    });
  };

  const years = useMemo(() => {
    const out: number[] = [];
    for (let y = last; y >= FIRST_YEAR; y--) out.push(y);
    return out;
  }, [last]);

  const loading = status.kind === 'loading';

  return (
    <div className="faq climate">
      <header className="masthead">
        <div className="masthead__inner">
          <Link href="/" className="faq__home" aria-label={t('faq.back')}>
            <LogoMark size={40} />
            <span className="masthead__where">
              <span className="masthead__brand-hi">{t('brand.name')}</span>
              {lang !== 'en' && (
                <span className="masthead__brand-en" lang="en">
                  {t('brand.wordmark')}
                </span>
              )}
            </span>
          </Link>
        </div>
      </header>

      <main className="climate__main">
        <h1 className="faq__title">{t('climate.title')}</h1>
        <p className="faq__intro">{t('climate.intro')}</p>

        <form className="climate__controls" onSubmit={onSubmit} aria-label={t('climate.controls')}>
          <div className="climate__field climate__field--place">
            <label htmlFor="climate-place" className="climate__label">
              {t('climate.place')}
            </label>
            <input
              id="climate-place"
              className="climate__input"
              value={place}
              onChange={(e) => setPlace(e.target.value)}
              placeholder={t('climate.placeHint')}
              autoComplete="off"
              enterKeyHint="search"
              maxLength={80}
            />
            <p className="climate__examples">
              <span>{t('climate.try')}</span>
              {EXAMPLES[lang].map((name) => (
                <button
                  key={name}
                  type="button"
                  className="climate__chip"
                  onClick={() => {
                    setPlace(name);
                    submit(name, draft);
                  }}
                >
                  {name}
                </button>
              ))}
            </p>
          </div>

          <fieldset className="climate__field climate__field--wide">
            <legend className="climate__label">{t('climate.preset')}</legend>
            <div className="climate__presets">
              {PRESET_KEYS.map((key) => (
                <label key={key} className={`climate__preset${draft.preset === key ? ' climate__preset--on' : ''}`}>
                  <input
                    type="radio"
                    name="preset"
                    value={key}
                    checked={draft.preset === key}
                    onChange={() => choosePreset(key)}
                  />
                  <span className="climate__preset-name">{t(`climate.preset.${key}` as StringKey)}</span>
                </label>
              ))}
            </div>
            <p className="climate__note">{t(`climate.presetNote.${draft.preset}` as StringKey)}</p>
          </fieldset>

          <fieldset className="climate__field">
            <legend className="climate__label">{t('climate.period')}</legend>
            <div className="climate__pair">
              <YearSelect label={t('climate.from')} value={draft.from} years={years} onChange={(from) => setDraft((d) => ({ ...d, from }))} />
              <YearSelect label={t('climate.to')} value={draft.to} years={years} onChange={(to) => setDraft((d) => ({ ...d, to }))} />
            </div>
          </fieldset>

          <fieldset className="climate__field">
            <legend className="climate__label">{t('climate.baseline')}</legend>
            <select
              className="climate__select"
              value={draft.baseline}
              onChange={(e) => setBaseline(e.target.value as BaselineKey)}
              aria-label={t('climate.baseline')}
            >
              {(Object.keys(BASELINES) as (keyof typeof BASELINES)[]).map((key) => (
                <option key={key} value={key}>
                  {key === '1991-2020'
                    ? t('climate.baseline.standard', { from: 1991, to: 2020 })
                    : `${BASELINES[key][0]}–${BASELINES[key][1]}`}
                </option>
              ))}
              <option value="custom">{t('climate.baseline.custom')}</option>
            </select>
            {draft.baseline === 'custom' && (
              <div className="climate__pair">
                <YearSelect label={t('climate.from')} value={draft.baselineFrom} years={years} onChange={(v) => setDraft((d) => ({ ...d, baselineFrom: v }))} />
                <YearSelect label={t('climate.to')} value={draft.baselineTo} years={years} onChange={(v) => setDraft((d) => ({ ...d, baselineTo: v }))} />
              </div>
            )}
            <p className="climate__note">{t('climate.baselineNote')}</p>
          </fieldset>

          <fieldset className="climate__field climate__field--wide">
            <legend className="climate__label">
              {t('climate.params')} <span className="climate__hint">{t('climate.paramsNote', { n: MAX_PARAMS })}</span>
            </legend>
            <div className="climate__groups">
              {PARAM_GROUPS.map(({ group, params }) => (
                <div key={group} className="climate__group">
                  <p className="climate__group-name">{t(`climate.group.${group}` as StringKey)}</p>
                  <div className="climate__chips">
                    {params.map((param) => {
                      const on = draft.params.includes(param);
                      const full = !on && draft.params.length >= MAX_PARAMS;
                      return (
                        <label key={param} className={`climate__toggle${on ? ' climate__toggle--on' : ''}${full ? ' climate__toggle--off' : ''}`}>
                          <input type="checkbox" checked={on} disabled={full} onChange={() => toggleParam(param)} />
                          <span>{t(`climate.param.${param}` as StringKey)}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </fieldset>

          <fieldset className="climate__field">
            <legend className="climate__label">{t('climate.resolution')}</legend>
            <div className="climate__segmented">
              {(['annual', 'monthly'] as const).map((res) => (
                <label key={res} className={draft.resolution === res ? 'climate__seg climate__seg--on' : 'climate__seg'}>
                  <input
                    type="radio"
                    name="resolution"
                    checked={draft.resolution === res}
                    onChange={() => setDraft((d) => ({ ...d, resolution: res }))}
                  />
                  <span>{t(res === 'annual' ? 'climate.res.annual' : 'climate.res.monthly')}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="climate__field">
            <label htmlFor="climate-season" className="climate__label">
              {t('climate.season')}
            </label>
            <select
              id="climate-season"
              className="climate__select"
              value={draft.season}
              onChange={(e) => setDraft((d) => ({ ...d, season: e.target.value as Draft['season'] }))}
            >
              {SEASON_KEYS.map((s) => (
                <option key={s} value={s}>
                  {t(`climate.season.${s}` as StringKey)}
                </option>
              ))}
            </select>
          </div>

          <div className="climate__actions">
            <button type="submit" className="climate__analyze" disabled={loading}>
              {loading ? t('climate.analyzing') : t('climate.analyze')}
            </button>
          </div>
        </form>

        <div className="climate__results" ref={resultsRef} tabIndex={-1} aria-busy={loading}>
          <Body status={status} t={t} lang={lang} last={last} />
        </div>

        <Link href="/" className="faq__back">
          <BackArrow />
          {t('faq.back')}
        </Link>
      </main>
    </div>
  );
}

function YearSelect({
  label,
  value,
  years,
  onChange,
}: {
  label: string;
  value: number;
  years: number[];
  onChange: (year: number) => void;
}) {
  return (
    <label className="climate__year">
      <span className="climate__sublabel">{label}</span>
      <select className="climate__select" value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {years.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
    </label>
  );
}

function Absence({ label, body }: { label: string; body: string }) {
  return (
    <section className="absence absence--nodata climate__absence" role="status">
      <p className="absence__label">
        <span className="absence__label-en">{label}</span>
      </p>
      <p className="climate__absence-body">{body}</p>
    </section>
  );
}

function Body({ status, t, lang, last }: { status: Status; t: Translate; lang: 'hi' | 'en'; last: number }) {
  switch (status.kind) {
    case 'idle':
      return (
        <section className="climate__empty">
          <h2 className="climate__empty-title">{t('climate.empty.title')}</h2>
          <p>{t('climate.empty.body')}</p>
          <ul>
            <li>{t('climate.empty.point1')}</li>
            <li>{t('climate.empty.point2')}</li>
            <li>{t('climate.empty.point3')}</li>
          </ul>
        </section>
      );
    case 'loading':
      return (
        <>
          <p className="climate__loading" role="status">
            {t('climate.loading', { years: status.years })}
          </p>
          <ResultsSkeleton />
        </>
      );
    case 'problem':
      return <Absence label={t('climate.error.invalid')} body={t(`climate.problem.${status.problem}` as StringKey, { last })} />;
    case 'offline':
      return <Absence label={t('climate.error.unreachable')} body={t('climate.error.unreachableBody')} />;
    case 'done': {
      const r = status.response;
      if (r.kind === 'analysis') return <ClimateResults analysis={r} t={t} lang={lang} />;
      if (r.kind === 'unresolved') return <Absence label={t('climate.error.unresolved')} body={r.noData.statement[lang]} />;
      if (r.kind === 'invalid') {
        return <Absence label={t('climate.error.invalid')} body={t(`climate.problem.${r.problem}` as StringKey, { last })} />;
      }
      if (r.reason === 'rateLimited') return <Absence label={t('climate.error.rateLimited')} body={t('climate.error.rateLimitedBody')} />;
      if (r.reason === 'noValues') return <Absence label={t('climate.error.noValues')} body={t('climate.error.noValuesBody')} />;
      return <Absence label={t('climate.error.unreachable')} body={t('climate.error.unreachableBody')} />;
    }
  }
}

/** Reserves the results' shape, so nothing jumps when they arrive. */
function ResultsSkeleton() {
  return (
    <div className="climate__skeleton" aria-hidden="true">
      <div className="climate__skeleton-tiles">
        <span />
        <span />
        <span />
      </div>
      <span className="climate__skeleton-chart" />
    </div>
  );
}


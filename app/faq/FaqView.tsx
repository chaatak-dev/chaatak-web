'use client';

/**
 * Questions and answers.
 *
 * A reading page in the product's own voice — an official notice, not a
 * marketing page: one column at a reading measure, questions as headings, the
 * answers in full rather than folded away, so nothing takes a tap to read in
 * sunlight and a screen reader can move by heading.
 *
 * It renders in the interface language, read from the same stores the app
 * uses, so a returning Hindi reader gets Hindi on the first paint. Every
 * string is in lib/i18n/strings.ts, human-written in both.
 */

import Link from 'next/link';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { bcp47 } from '@/lib/i18n/languages';
import { deviceLanguages, languagesSnapshot, serverLanguagesSnapshot, subscribeLanguages } from '@/lib/i18n/local';
import { resolveLanguages } from '@/lib/i18n/preferences';
import { translator, type StringKey } from '@/lib/i18n/strings';
import { LogoMark } from '../components/LogoMark';

type Group = { id: string; heading: StringKey; items: [StringKey, StringKey][] };

const GROUPS: Group[] = [
  {
    id: 'chaatak',
    heading: 'faq.g.about',
    items: [
      ['faq.q.what', 'faq.a.what'],
      ['faq.q.account', 'faq.a.account'],
    ],
  },
  {
    id: 'sources',
    heading: 'faq.g.data',
    items: [
      ['faq.q.sources', 'faq.a.sources'],
      ['faq.q.ai', 'faq.a.ai'],
      ['faq.q.nature', 'faq.a.nature'],
      ['faq.q.nodata', 'faq.a.nodata'],
      ['faq.q.aqi', 'faq.a.aqi'],
    ],
  },
  {
    id: 'warnings',
    heading: 'faq.g.warnings',
    items: [
      ['faq.q.colours', 'faq.a.colours'],
      ['faq.q.automatic', 'faq.a.automatic'],
      ['faq.q.district', 'faq.a.district'],
    ],
  },
  {
    id: 'voice',
    heading: 'faq.g.voice',
    items: [
      ['faq.q.voice', 'faq.a.voice'],
      ['faq.q.languages', 'faq.a.languages'],
    ],
  },
  {
    id: 'privacy',
    heading: 'faq.g.privacy',
    items: [
      ['faq.q.recording', 'faq.a.recording'],
      ['faq.q.location', 'faq.a.location'],
      ['faq.q.stored', 'faq.a.stored'],
    ],
  },
  {
    id: 'limits',
    heading: 'faq.g.limits',
    items: [
      ['faq.q.limits', 'faq.a.limits'],
      ['faq.q.offline', 'faq.a.offline'],
    ],
  },
];

const noopSubscribe = () => () => {};

function BackArrow() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M10 3.5L5.5 8l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function FaqView() {
  const preferences = useSyncExternalStore(subscribeLanguages, languagesSnapshot, serverLanguagesSnapshot);
  const device = useSyncExternalStore(noopSubscribe, deviceLanguages, () => undefined);
  const ui = useMemo(() => resolveLanguages(preferences, device).ui, [preferences, device]);
  const t = useMemo(() => translator(ui), [ui]);

  // The document's language drives the Devanagari face and a screen
  // reader's voice, exactly as on the main page.
  useEffect(() => {
    document.documentElement.lang = bcp47(ui);
  }, [ui]);

  return (
    <div className="faq">
      <header className="masthead">
        <div className="masthead__inner">
          <Link href="/" className="faq__home" aria-label={t('faq.back')}>
            <LogoMark size={40} />
            <span className="masthead__where">
              <span className="masthead__brand-hi">{t('brand.name')}</span>
              {ui !== 'en' && (
                <span className="masthead__brand-en" lang="en">
                  {t('brand.wordmark')}
                </span>
              )}
            </span>
          </Link>
        </div>
      </header>

      <main className="faq__main">
        <h1 className="faq__title">{t('faq.title')}</h1>
        <p className="faq__intro">{t('faq.intro')}</p>

        <nav className="faq__contents" aria-label={t('faq.contents')}>
          <ul>
            {GROUPS.map((group) => (
              <li key={group.id}>
                <a href={`#${group.id}`}>{t(group.heading)}</a>
              </li>
            ))}
          </ul>
        </nav>

        {GROUPS.map((group) => (
          <section key={group.id} id={group.id} className="faq__group" aria-labelledby={`${group.id}-heading`}>
            <h2 id={`${group.id}-heading`} className="faq__group-heading">
              {t(group.heading)}
            </h2>
            {group.items.map(([question, answer]) => (
              <div key={question} className="faq__item">
                <h3 className="faq__q">{t(question)}</h3>
                {t(answer)
                  .split('\n\n')
                  .map((paragraph, i) => (
                    <p key={i} className="faq__a">
                      {paragraph}
                    </p>
                  ))}
              </div>
            ))}
          </section>
        ))}

        <Link href="/" className="faq__back">
          <BackArrow />
          {t('faq.back')}
        </Link>
      </main>
    </div>
  );
}

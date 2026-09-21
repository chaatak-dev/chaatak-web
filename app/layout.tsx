import type { Metadata, Viewport } from 'next';
import {
  Instrument_Sans,
  Noto_Sans_Bengali,
  Noto_Sans_Devanagari,
  Noto_Sans_Gujarati,
  Noto_Sans_Gurmukhi,
  Noto_Sans_Tamil,
} from 'next/font/google';
import { THEME_BOOTSTRAP } from '@/lib/theme';
import './globals.css';
import './chaatak.css';

const instrumentSans = Instrument_Sans({
  subsets: ['latin'],
  variable: '--font-instrument',
  display: 'swap',
});

/**
 * Devanagari is the primary face here, not a fallback for missing glyphs.
 * Latin is included in the subset so a Hindi string containing a number or a
 * place name in Latin script stays on one face instead of breaking mid-line.
 */
const notoSansDevanagari = Noto_Sans_Devanagari({
  subsets: ['devanagari', 'latin'],
  variable: '--font-noto-devanagari',
  display: 'swap',
});

/*
 * The other four Indic scripts, each `preload: false`.
 *
 * The audience is on a cheap Android phone and a weak connection, so a Hindi
 * speaker must not pay to download Tamil. Without preload the browser fetches
 * a face only once an element actually renders in it — which happens when
 * someone picks that language, and never otherwise.
 *
 * Marathi is absent on purpose: it is written in Devanagari, already loaded.
 */
const notoSansBengali = Noto_Sans_Bengali({
  subsets: ['bengali'],
  variable: '--font-noto-bengali',
  display: 'swap',
  preload: false,
});

const notoSansGujarati = Noto_Sans_Gujarati({
  subsets: ['gujarati'],
  variable: '--font-noto-gujarati',
  display: 'swap',
  preload: false,
});

const notoSansTamil = Noto_Sans_Tamil({
  subsets: ['tamil'],
  variable: '--font-noto-tamil',
  display: 'swap',
  preload: false,
});

const notoSansGurmukhi = Noto_Sans_Gurmukhi({
  subsets: ['gurmukhi'],
  variable: '--font-noto-gurmukhi',
  display: 'swap',
  preload: false,
});

const FONT_VARIABLES = [
  instrumentSans.variable,
  notoSansDevanagari.variable,
  notoSansBengali.variable,
  notoSansGujarati.variable,
  notoSansTamil.variable,
  notoSansGurmukhi.variable,
].join(' ');

export const metadata: Metadata = {
  title: 'Chaatak — IMD forecasts and warnings',
  description:
    'Official India Meteorological Department forecasts and warnings, in your own language, before you ask.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  /*
   * The keyboard shrinks the page instead of covering it.
   *
   * The app shell is a fixed 100dvh column with the composer pinned to the
   * bottom and the body not scrolling. By default a software keyboard is
   * drawn OVER that layout, so on Android the input someone is typing into
   * ends up underneath it — the one element that has to stay visible.
   *
   * `resizes-content` makes the keyboard resize the layout viewport, so the
   * shell shortens and the composer sits on top of the keyboard where it
   * belongs. iOS ignores it; the composer there is handled by scrolling it
   * back into view on focus.
   */
  interactiveWidget: 'resizes-content',
  // The browser chrome follows the palette, so a dark page does not sit under
  // a bright status bar at 3am.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#FFFDF9' },
    { media: '(prefers-color-scheme: dark)', color: '#16181A' },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={FONT_VARIABLES}
    >
      <head>
        {/*
          Applies the stored theme before first paint. Without it the page
          renders light and then corrects itself — trivial in daylight, and
          genuinely unpleasant at 3am, which is when a warning is most likely
          to wake someone.
        */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

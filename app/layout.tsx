import type { Metadata, Viewport } from 'next';
import { Instrument_Sans, Noto_Sans_Devanagari } from 'next/font/google';
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

export const metadata: Metadata = {
  title: 'Chaatak — IMD forecasts and warnings',
  description:
    'Official India Meteorological Department forecasts and warnings, in your own language, before you ask.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
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
      className={`${instrumentSans.variable} ${notoSansDevanagari.variable}`}
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

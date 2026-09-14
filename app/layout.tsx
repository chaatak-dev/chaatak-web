import type { Metadata, Viewport } from 'next';
import { Instrument_Sans, Noto_Sans_Devanagari } from 'next/font/google';
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
  themeColor: '#FFFDF9',
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
      <body>{children}</body>
    </html>
  );
}

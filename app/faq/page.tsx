import type { Metadata } from 'next';
import { FaqView } from './FaqView';

export const metadata: Metadata = {
  title: 'Questions and answers — Chaatak',
  description:
    'How Chaatak works: IMD warnings and the weather in your language, where the numbers come from, voice, languages, privacy and limits.',
};

export default function FaqPage() {
  return <FaqView />;
}

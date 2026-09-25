import type { Metadata } from 'next';
import { ClimateView } from './ClimateView';
// Route-scoped: the conversation page never downloads these rules.
import './climate.css';

export const metadata: Metadata = {
  title: 'Historical climate analysis — Chaatak',
  description:
    'Historical weather, trends and extremes for any place in India, from ERA5 reanalysis: baselines, anomalies, rainfall, dry spells and heat.',
};

export default function ClimatePage() {
  return <ClimateView />;
}

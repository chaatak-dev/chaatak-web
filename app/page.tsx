'use client';

/**
 * The page.
 *
 * Everything below is a client component and deliberately so: the transcript,
 * the mic, the offline cache and the session all live in the browser, and a
 * server-rendered shell around them would only add a hydration boundary to
 * get wrong. The weather itself is never rendered here — it arrives through
 * /api/chat, having been fetched from an adapter and verified before it was
 * allowed into the answer.
 */

import { AppProvider } from './components/AppState';
import { AppShell } from './components/AppShell';

export default function Page() {
  return (
    <AppProvider>
      <AppShell />
    </AppProvider>
  );
}

'use client';

/**
 * The shell: a sidebar and a conversation.
 *
 * On a wide screen the sidebar is a column that is simply there. Below
 * 1024px it is a drawer over the conversation, because a phone has one
 * column and the conversation is what it is for.
 *
 * The drawer is rendered at every width rather than mounted and unmounted on
 * a breakpoint. A component that only exists on small screens is a component
 * that is only tested on small screens, and this one holds the account menu.
 *
 * AS A DRAWER IT IS MODAL, and behaves like one: focus moves into it when it
 * opens, the page behind it is inert — not merely covered — so Tab cannot
 * wander underneath the scrim, Escape closes it, and focus returns to the
 * button that opened it.
 */

import { useEffect, useRef } from 'react';
import { ChatView } from './ChatView';
import { Sidebar } from './Sidebar';
import { WeatherRail } from './WeatherRail';
import { useApp } from './AppState';

/** The width below which the sidebar is a drawer. Matches the CSS. */
const DRAWER_QUERY = '(max-width: 1023.98px)';

export function AppShell() {
  const app = useApp();
  const { drawerOpen, setDrawerOpen, t } = app;
  const mainRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  /*
   * The shell is pinned to the VISUAL viewport — its top AND its height.
   *
   * The app is a fixed column with the composer at the bottom and a document
   * that never scrolls. Android is handled declaratively by
   * `interactive-widget: resizes-content`: the keyboard shrinks the layout.
   * iOS ignores that. It draws the keyboard over the layout and then PANS the
   * visual viewport down to reveal the focused input — visualViewport's
   * offsetTop becomes roughly the keyboard's height.
   *
   * Following only the height was the bug. The shell shortened to what was
   * visible but stayed anchored at the top of the layout, so on iPhone the
   * person saw the bottom of a short shell — the composer halfway up the
   * screen — and, below it, the empty page the view had panned into. So the
   * shell takes both: top = offsetTop, height = height, and it sits exactly
   * over what can be seen, keyboard or not.
   *
   * Pinch-zoom is left alone: following the visual viewport while zoomed
   * would pin the page to the magnifier and make zooming do nothing.
   *
   * `data-keyboard` marks a text field focused with the viewport covered, so
   * the composer drops the home-indicator padding the keyboard now hides.
   *
   * Absent (older browsers), nothing is set and the CSS falls back to 100dvh.
   */
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const root = document.documentElement;
    let frame = 0;

    const apply = () => {
      frame = 0;
      if (viewport.scale > 1.01) return;
      root.style.setProperty('--viewport-height', `${Math.round(viewport.height)}px`);
      root.style.setProperty('--viewport-top', `${Math.round(viewport.offsetTop)}px`);
      const field = document.activeElement;
      const typing = field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || (field instanceof HTMLElement && field.isContentEditable);
      root.toggleAttribute('data-keyboard', typing && root.clientHeight - viewport.height > 120);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };
    // iOS can leave the document scrolled once the keyboard has gone, which
    // leaves a band of empty page under the composer. The document never
    // scrolls on purpose, so any scroll left over is put back.
    const settle = () => {
      schedule();
      window.setTimeout(() => {
        if (window.scrollY !== 0 || window.scrollX !== 0) window.scrollTo(0, 0);
        schedule();
      }, 250);
    };

    apply();
    viewport.addEventListener('resize', schedule);
    viewport.addEventListener('scroll', schedule);
    window.addEventListener('focusin', schedule);
    window.addEventListener('focusout', settle);
    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener('resize', schedule);
      viewport.removeEventListener('scroll', schedule);
      window.removeEventListener('focusin', schedule);
      window.removeEventListener('focusout', settle);
      root.style.removeProperty('--viewport-height');
      root.style.removeProperty('--viewport-top');
      root.removeAttribute('data-keyboard');
    };
  }, []);

  // The drawer as a modal: Escape, inert background, focus in and back out.
  useEffect(() => {
    const narrow = window.matchMedia(DRAWER_QUERY).matches;
    if (!drawerOpen || !narrow) return;

    openerRef.current = document.activeElement as HTMLElement | null;
    const behind = [mainRef.current, railRef.current].filter((el): el is HTMLElement => el !== null);
    for (const el of behind) el.inert = true;

    // Into the drawer: its first control, which is the close button.
    const first = sidebarRef.current?.querySelector<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select, [tabindex]:not([tabindex="-1"])',
    );
    first?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    window.addEventListener('keydown', onKey);

    return () => {
      window.removeEventListener('keydown', onKey);
      for (const el of behind) el.inert = false;
      // Back to where the person was — the menu button, usually.
      const opener = openerRef.current;
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [drawerOpen, setDrawerOpen]);

  return (
    <div className={`shell${drawerOpen ? ' shell--drawer-open' : ''}`}>
      {/*
        The first thing a keyboard reaches. The sidebar comes first in the
        document, and without this every visit starts with a walk through
        the chat history before the question box.
      */}
      <a className="skiplink" href="#composer-input">
        {t('nav.skipToChat')}
      </a>

      {/*
        Hidden with `visibility` rather than only moved off-screen while it is
        a closed drawer. A transform alone leaves every control inside it
        focusable, and the first Tab out of the composer lands in an invisible
        menu. `visibility: hidden` takes it out of the tab order and out of the
        accessibility tree at the same time, in CSS, at the one breakpoint
        where it is a drawer at all.
      */}
      <nav
        id="sidebar"
        ref={sidebarRef}
        className="sidebar"
        aria-label={t('nav.sidebar')}
      >
        <Sidebar />
      </nav>

      {/*
        The scrim. Closing the drawer by tapping beside it is a pointer
        affordance; the keyboard has Escape and the close button, so the scrim
        itself stays out of the tab order and out of the accessibility tree.
      */}
      <div
        className="shell__scrim"
        onClick={() => setDrawerOpen(false)}
        aria-hidden="true"
      />

      <div className="shell__main" ref={mainRef}>
        {/*
          Keyed on a DELIBERATE move to another conversation, so switching
          remounts the view and starting one does not.

          The remount is the reset: the standing place, the half-typed
          question, the voice session and the "which place?" state all belong
          to the conversation that was open, and carrying them into another
          one would answer the next question about the last conversation's
          district. An effect that cleared them would do the same thing later
          and less reliably.

          `app.activeId` looks like the right key and is not — the first
          message in a new chat takes it from null to a uuid, which would
          remount the view mid-conversation and throw away the standing place
          that the very next question depends on.
        */}
        <ChatView key={app.viewKey} />
      </div>

      {/*
        The third column: what the weather is doing where the conversation is
        about. Present only where there is room for it — below 1280 the
        conversation is the whole point of the screen, and a weather panel
        stacked above it would push the transcript off.
      */}
      <aside className="rail" aria-label={t('rail.title')} ref={railRef}>
        <WeatherRail />
      </aside>
    </div>
  );
}

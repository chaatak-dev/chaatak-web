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
 */

import { useEffect } from 'react';
import { ChatView } from './ChatView';
import { Sidebar } from './Sidebar';
import { WeatherRail } from './WeatherRail';
import { useApp } from './AppState';

export function AppShell() {
  const app = useApp();
  const { drawerOpen, setDrawerOpen } = app;

  /*
   * The shell follows the VISUAL viewport, not the layout one.
   *
   * The app is a fixed-height column with the composer pinned to the bottom
   * and the body not scrolling — which is right until a keyboard appears.
   * Android is handled declaratively by `interactive-widget: resizes-content`
   * in the viewport meta; iOS ignores that entirely and draws the keyboard
   * OVER the layout, leaving the text input someone is typing into
   * underneath it. Since the body cannot scroll, nothing brings it back.
   *
   * visualViewport.height is what the person can actually see. Writing it to
   * a custom property lets the shell shorten by exactly the height of the
   * keyboard, so the composer ends up sitting on top of it.
   *
   * Absent (older browsers) the property is never set and the CSS falls back
   * to 100dvh, which is the behaviour this replaces.
   */
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const apply = () => {
      document.documentElement.style.setProperty(
        '--viewport-height',
        `${Math.round(viewport.height)}px`,
      );
    };

    apply();
    viewport.addEventListener('resize', apply);
    return () => {
      viewport.removeEventListener('resize', apply);
      document.documentElement.style.removeProperty('--viewport-height');
    };
  }, []);

  // Escape closes it, the same as every other overlay in the product.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen, setDrawerOpen]);

  return (
    <div className={`shell${drawerOpen ? ' shell--drawer-open' : ''}`}>
      {/*
        Hidden with `visibility` rather than only moved off-screen while it is
        a closed drawer. A transform alone leaves every control inside it
        focusable, and the first Tab out of the composer lands in an invisible
        menu. `visibility: hidden` takes it out of the tab order and out of the
        accessibility tree at the same time, in CSS, at the one breakpoint
        where it is a drawer at all — which `inert` cannot do without a media
        query in JavaScript.
      */}
      <nav className="sidebar" aria-label="Chats and locations">
        <Sidebar />
      </nav>

      {/*
        The scrim. A button rather than a div: closing the drawer by tapping
        beside it is a real action and belongs to something focusable.
      */}
      <button
        type="button"
        className="shell__scrim"
        onClick={() => setDrawerOpen(false)}
        tabIndex={drawerOpen ? 0 : -1}
        aria-label="Close menu"
        aria-hidden={!drawerOpen}
      />

      <div className="shell__main">
        {/*
          Keyed on a DELIBERATE move to another conversation, so switching
          remounts the view and starting one does not.

          The remount is the reset: the standing place, the half-typed
          question, the mic and the "which place?" state all belong to the
          conversation that was open, and carrying them into another one would
          answer the next question about the last conversation's district. An
          effect that cleared them would do the same thing later and less
          reliably.

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

        Rendered inside the shell rather than inside the chat column so it is
        a sibling of the conversation, not a child of it: it survives a
        conversation switch, and the column that scrolls stays the one that
        should.
      */}
      <aside className="rail" aria-label={app.t('rail.title')}>
        <WeatherRail />
      </aside>
    </div>
  );
}

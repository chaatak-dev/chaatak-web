'use client';

/**
 * The sidebar: new chat, recent conversations, monitored places, account.
 *
 * A column on a wide screen, a drawer on a phone — one component, one set of
 * markup, positioned by CSS. Two copies would mean two places to forget a
 * change, and the drawer is the one nobody tests.
 *
 * Recents are for a signed-in account only, because a guest's conversation
 * lives in the tab and there is nothing to list. Rather than hiding the
 * section, it says what signing in would do — a blank space explains nothing.
 */

import { useEffect, useRef, useState } from 'react';
import { useApp } from './AppState';
import { AccountMenu } from './AccountMenu';
import { ConfirmDialog } from './ConfirmDialog';
import { LocationsPanel } from './LocationsPanel';
import { LogoMark } from './LogoMark';
import { UNTITLED } from '@/lib/accounts/title';

export function Sidebar() {
  const app = useApp();

  return (
    <div className="sidebar__inner">
      <div className="sidebar__top">
        <span className="sidebar__mark">
          <LogoMark size={40} />
        </span>
        <p className="sidebar__brand">
          <span lang="hi" className="sidebar__brand-hi">
            चातक
          </span>
          <span className="sidebar__brand-en">Chaatak</span>
        </p>

        {/* Only reachable when the sidebar is a drawer; hidden by CSS above. */}
        <button
          type="button"
          className="sidebar__close"
          onClick={() => app.setDrawerOpen(false)}
          aria-label="Close menu"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path
              d="M4 4l8 8M12 4l-8 8"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      <button type="button" className="sidebar__new" onClick={app.newChat}>
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M8 3.5v9M3.5 8h9"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
        <span lang="hi">नई बातचीत</span>
        <span className="sidebar__new-en">New chat</span>
      </button>

      <div className="sidebar__scroll">
        <RecentChats />
        <LocationsPanel />
      </div>

      <AccountMenu />
    </div>
  );
}

function RecentChats() {
  const app = useApp();

  if (!app.user) {
    if (!app.configured) return null;
    return (
      <section className="recents">
        <h2 className="sidebar__heading">
          <span lang="hi">पिछली बातचीत</span>
          <span className="sidebar__heading-en">Recent</span>
        </h2>
        <p className="recents__empty">
          <span lang="hi">
            बातचीत सहेजने के लिए साइन इन करें। बिना खाते के यह बातचीत सिर्फ़ इस
            टैब तक रहती है।
          </span>
          <span className="recents__empty-en">
            Sign in to keep your chats. Without an account this conversation
            lasts as long as the tab.
          </span>
        </p>
      </section>
    );
  }

  return (
    <section className="recents">
      <h2 className="sidebar__heading">
        <span lang="hi">पिछली बातचीत</span>
        <span className="sidebar__heading-en">Recent</span>
      </h2>

      {app.conversations.length === 0 ? (
        <p className="recents__empty">
          <span lang="hi">अभी कुछ नहीं। कुछ पूछें।</span>
          <span className="recents__empty-en">Nothing yet. Ask something.</span>
        </p>
      ) : (
        <ul className="recents__list">
          {app.conversations.map((conversation) => (
            <RecentRow
              key={conversation.id}
              id={conversation.id}
              title={conversation.title}
              active={conversation.id === app.activeId}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function RecentRow({
  id,
  title,
  active,
}: {
  id: string;
  title: string | null;
  active: boolean;
}) {
  const app = useApp();
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [draft, setDraft] = useState(title ?? '');
  const rowRef = useRef<HTMLLIElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renaming) inputRef.current?.select();
  }, [renaming]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent) => {
      if (!rowRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  // Hindi is primary in the type hierarchy, in the sidebar as everywhere
  // else. An unnamed conversation is named in the language the product leads
  // with, not in its subtitle.
  const untitled = title === null;
  const label = title ?? UNTITLED.hi;

  if (renaming) {
    return (
      <li className="recents__item" ref={rowRef}>
        <form
          className="recents__rename"
          onSubmit={(event) => {
            event.preventDefault();
            const next = draft.trim();
            setRenaming(false);
            if (next && next !== title) void app.rename(id, next);
          }}
        >
          <input
            ref={inputRef}
            className="recents__input"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => setRenaming(false)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setDraft(title ?? '');
                setRenaming(false);
              }
            }}
            aria-label="Conversation name"
            maxLength={120}
          />
        </form>
      </li>
    );
  }

  return (
    <li className={`recents__item${active ? ' recents__item--active' : ''}`} ref={rowRef}>
      <button
        type="button"
        className="recents__open"
        onClick={() => app.openConversation(id)}
        /*
          Read ahead on intent. A pointer resting on a row, or a finger
          touching it, comes a few hundred milliseconds before the click —
          which is most of what opening a conversation costs. By the time the
          click lands the messages are usually already here.
        */
        onPointerEnter={() => app.prefetchConversation(id)}
        onTouchStart={() => app.prefetchConversation(id)}
        onFocus={() => app.prefetchConversation(id)}
        aria-current={active ? 'true' : undefined}
        lang={untitled ? 'hi' : undefined}
      >
        {label}
      </button>

      <button
        type="button"
        className="recents__more"
        aria-label={`Actions for ${label}`}
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((was) => !was)}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="3.5" cy="8" r="1.3" fill="currentColor" />
          <circle cx="8" cy="8" r="1.3" fill="currentColor" />
          <circle cx="12.5" cy="8" r="1.3" fill="currentColor" />
        </svg>
      </button>

      {menuOpen && (
        <div className="recents__menu" role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              setDraft(title ?? '');
              setRenaming(true);
            }}
          >
            <span lang="hi">नाम बदलें</span>
            <span className="recents__menu-en">Rename</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="recents__menu-danger"
            onClick={() => {
              setMenuOpen(false);
              setConfirming(true);
            }}
          >
            <span lang="hi">मिटाएँ</span>
            <span className="recents__menu-en">Delete</span>
          </button>
        </div>
      )}

      <ConfirmDialog
        open={confirming}
        headline="यह बातचीत मिटाएँ?"
        headlineEn="Delete this chat?"
        body="इस बातचीत के सारे संदेश हमेशा के लिए मिट जाएँगे।"
        bodyEn="Every message in this conversation goes, permanently."
        confirmLabel="मिटाएँ"
        confirmLabelEn="Delete"
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          void app.remove(id);
        }}
      />
    </li>
  );
}

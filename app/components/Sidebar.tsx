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

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useApp } from './AppState';
import { AccountMenu } from './AccountMenu';
import { ConfirmDialog } from './ConfirmDialog';
import { LocationsPanel } from './LocationsPanel';
import { LogoMark } from './LogoMark';

export function Sidebar() {
  const app = useApp();

  return (
    <div className="sidebar__inner">
      <div className="sidebar__top">
        {/* The mark and name are the way home: a fresh chat. */}
        <button type="button" className="sidebar__home" onClick={app.newChat} aria-label={app.t('nav.home')}>
          <span className="sidebar__mark">
            <LogoMark size={40} />
          </span>
          {/*
            The second line is the romanisation, and it only means anything
            under the Devanagari one. In English it said "Chaatak" twice.
          */}
          <span className="sidebar__brand">
            <span className="sidebar__brand-hi">{app.t('brand.name')}</span>
            {app.languages.ui !== 'en' && (
              <span className="sidebar__brand-en" lang="en">
                {app.t('brand.wordmark')}
              </span>
            )}
          </span>
        </button>

        {/* Only reachable when the sidebar is a drawer; hidden by CSS above. */}
        <button
          type="button"
          className="sidebar__close"
          onClick={() => app.setDrawerOpen(false)}
          aria-label={app.t('nav.close')}
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
        <span>{app.t('nav.newChat')}</span>
      </button>

      <div className="sidebar__scroll">
        <RecentChats />
        <LocationsPanel />
      </div>

      {/* Its own page and its own chunk: nothing of it loads until opened. */}
      <Link href="/climate" className="sidebar__faq sidebar__climate" prefetch={false}>
        <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path d="M3 16.5h14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <path
            d="M3.5 13l3.6-4.2 3 2.4 4.6-6.2 1.8 1.6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="sidebar__climate-text">
          <span>{app.t('climate.nav.title')}</span>
          <span className="sidebar__climate-sub">{app.t('climate.nav.sub')}</span>
        </span>
      </Link>

      <Link href="/faq" className="sidebar__faq">
        <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <circle cx="10" cy="10" r="7.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path
            d="M7.9 7.8a2.2 2.2 0 1 1 3.1 2c-.6.3-1 .8-1 1.4v.4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <circle cx="10" cy="14.2" r="0.95" fill="currentColor" />
        </svg>
        <span>{app.t('faq.link')}</span>
      </Link>

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
        <h2 className="sidebar__heading">{app.t('nav.recent')}</h2>
        <p className="recents__empty">{app.t('recents.emptySignedOut')}</p>
      </section>
    );
  }

  return (
    <section className="recents">
      <h2 className="sidebar__heading">{app.t('nav.recent')}</h2>

      {app.conversations.length === 0 ? (
        <p className="recents__empty">{app.t('recents.empty')}</p>
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
  const moreRef = useRef<HTMLButtonElement>(null);
  const menuId = `actions-${id}`;

  useEffect(() => {
    if (renaming) inputRef.current?.select();
  }, [renaming]);

  /*
   * A disclosure, not an ARIA menu: a button that shows two ordinary buttons.
   * `role="menu"` promises arrow keys and managed focus, and a promise the
   * widget does not keep is worse for a screen-reader user than no promise.
   * What it does keep: Escape closes it and puts focus back on the button,
   * and so does a click or a focus anywhere else.
   */
  useEffect(() => {
    if (!menuOpen) return;
    const closeOutside = (event: Event) => {
      if (!rowRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setMenuOpen(false);
      moreRef.current?.focus();
    };
    document.addEventListener('mousedown', closeOutside);
    document.addEventListener('focusin', closeOutside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', closeOutside);
      document.removeEventListener('focusin', closeOutside);
      document.removeEventListener('keydown', escape);
    };
  }, [menuOpen]);

  // An unnamed conversation is named in the interface language, like every
  // other piece of chrome. The document's `lang` already declares which that
  // is, so the row needs no tag of its own.
  const label = title ?? app.t('nav.untitled');

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
            aria-label={app.t('nav.conversationName')}
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
      >
        {label}
      </button>

      <button
        ref={moreRef}
        type="button"
        className="recents__more"
        aria-label={app.t('nav.actionsFor', { name: label })}
        aria-expanded={menuOpen}
        aria-controls={menuId}
        onClick={() => setMenuOpen((was) => !was)}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <circle cx="3.5" cy="8" r="1.3" fill="currentColor" />
          <circle cx="8" cy="8" r="1.3" fill="currentColor" />
          <circle cx="12.5" cy="8" r="1.3" fill="currentColor" />
        </svg>
      </button>

      {menuOpen && (
        <div className="recents__menu" id={menuId}>
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              setDraft(title ?? '');
              setRenaming(true);
            }}
          >
            {app.t('nav.rename')}
          </button>
          <button
            type="button"
            className="recents__menu-danger"
            onClick={() => {
              setMenuOpen(false);
              // The dialog returns focus to whatever opened it. That was this
              // item, which is about to vanish — so the row's button is where
              // focus waits, and where it lands after Cancel.
              moreRef.current?.focus();
              setConfirming(true);
            }}
          >
            {app.t('nav.delete')}
          </button>
        </div>
      )}

      <ConfirmDialog
        open={confirming}
        headline="confirm.deleteChat.headline"
        body="confirm.deleteChat.body"
        confirmLabel="confirm.deleteChat.confirm"
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          void app.remove(id);
        }}
      />
    </li>
  );
}

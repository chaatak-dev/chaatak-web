/**
 * The bot, wired to the real things.
 *
 * Every dependency here is something the website already uses: the chat
 * pipeline, the snapshot, the place resolver, the gazetteer, the account
 * store. Telegram brings its own client and its own store and nothing else.
 */

import {
  addLocation,
  listLocations,
  readProfile,
  removeLocation,
  saveLanguagePreferences,
} from '../accounts/store';
import { answerQuestion } from '../chat/answer';
import { resolvePoint } from '../weather/point';
import { snapshotFor } from '../weather/snapshot';
import { placeResolver } from '../weather/source';
import { callTelegram } from './api';
import { createBot } from './bot';
import { postgresTelegramStore } from './store';

let bot: ReturnType<typeof createBot> | null = null;

export function telegramBot() {
  bot ??= createBot({
    // One retry on a transient failure: a reply is worth a second try, and a
    // webhook invocation can afford one.
    send: (method, params) => callTelegram(method, params, { retries: 1 }),
    store: postgresTelegramStore,
    answer: answerQuestion,
    snapshot: snapshotFor,
    resolvePlace: (query) => placeResolver().resolve(query),
    resolvePoint,
    accounts: {
      profile: readProfile,
      locations: listLocations,
      addLocation,
      removeLocation,
      saveLanguages: saveLanguagePreferences,
    },
  });
  return bot;
}

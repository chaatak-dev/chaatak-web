/**
 * The slice of the Telegram Bot API this bot reads and writes.
 *
 * Hand-written rather than pulled from a library: the bot uses a dozen fields,
 * and a dependency that models all of Telegram would be most of its weight in
 * things nothing here touches. Every field is optional where Telegram says it
 * may be absent, so a missing one is handled rather than assumed.
 */

export type TgUser = {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  username?: string;
  /** IETF tag of the user's Telegram language. A hint, never a preference. */
  language_code?: string;
};

export type TgChat = {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
};

export type TgLocation = {
  latitude: number;
  longitude: number;
};

export type TgMessage = {
  message_id: number;
  date: number;
  chat: TgChat;
  from?: TgUser;
  text?: string;
  location?: TgLocation;
  /** The buttons under a message the bot sent, echoed back on a callback. */
  reply_markup?: InlineKeyboard;
  /** Present for anything the bot cannot read — photos, voice, stickers. */
  voice?: unknown;
  photo?: unknown;
  sticker?: unknown;
};

export type TgCallbackQuery = {
  id: string;
  from: TgUser;
  message?: TgMessage;
  data?: string;
};

export type TgChatMemberUpdated = {
  chat: TgChat;
  from: TgUser;
  new_chat_member: { status: string; user?: TgUser };
};

export type TgUpdate = {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
  my_chat_member?: TgChatMemberUpdated;
};

/* ---- what the bot sends -------------------------------------------- */

export type InlineButton =
  | { text: string; callback_data: string; style?: ButtonStyle }
  | { text: string; url: string; style?: ButtonStyle };

/**
 * Telegram's button colours (Bot API 9.4). Used for exactly two meanings:
 * the one primary action on a message, and a destructive one. Everything
 * else takes the client's own style — colour here means something, as it
 * does everywhere else in Chaatak.
 */
export type ButtonStyle = 'primary' | 'danger';

export type InlineKeyboard = { inline_keyboard: InlineButton[][] };

export type ReplyKeyboard = {
  keyboard: ({ text: string; request_location?: boolean })[][];
  resize_keyboard?: boolean;
  is_persistent?: boolean;
  one_time_keyboard?: boolean;
  input_field_placeholder?: string;
};

export type ReplyMarkup = InlineKeyboard | ReplyKeyboard | { remove_keyboard: true };

/** A message ready to send: HTML text and whatever sits under it. */
export type OutgoingMessage = {
  html: string;
  markup?: ReplyMarkup;
  /** Delivered without a sound. An all-clear should not wake anyone. */
  silent?: boolean;
};

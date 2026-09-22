/**
 * Every word of interface chrome, in one place.
 *
 * WHY A CATALOGUE AT ALL. The interface used to be bilingual everywhere —
 * a Hindi line with an English line under it, on every label, permanently.
 * That was the right answer while there was no language setting, because it
 * served both audiences at once. With one, it is the wrong answer twice
 * over: someone who chose Hindi should not have to read English under every
 * button, and someone who chose English should not be shown Devanagari they
 * cannot read. So the strings move out of the markup and the interface
 * renders in ONE language.
 *
 * THE HINDI HERE IS THE HINDI THAT WAS ALREADY IN THE PRODUCT. It was
 * written by hand, and it has been moved rather than regenerated. Nothing in
 * this file is machine-translated, and nothing in this file may be: the
 * warning taxonomy lives next door under the same rule, and a catalogue that
 * starts accepting machine output for "just the chrome" is one edit away from
 * accepting it for a severity.
 *
 * ADDING A LANGUAGE is adding a key to each entry and flipping
 * `support.interface` in languages.ts. Automatic detection follows that flag,
 * so a language becomes detectable in the same commit that makes it
 * readable — never before.
 */

import type { InterfaceLang } from './languages';

/** One string, in every language whose interface exists. */
type Entry = Record<InterfaceLang, string>;

/**
 * `{name}` is the only substitution, and it is a person's own name.
 *
 * Deliberately not a general template system: a catalogue that can splice
 * arbitrary values into a sentence is a catalogue that can splice a weather
 * value into one, and a number that reaches the screen through the string
 * table has gone around the verification gate.
 */
export const STRINGS = {
  /* ---- the shell ------------------------------------------------- */
  'brand.name': { hi: 'चातक', en: 'Chaatak' },
  /* The Latin romanisation under the Devanagari mark. Not a translation —
     it is the same word, and it is shown only where it adds one. */
  'brand.wordmark': { hi: 'CHAATAK', en: 'CHAATAK' },

  'nav.open': { hi: 'बातचीत और जगहें खोलें', en: 'Open chats and locations' },
  'nav.close': { hi: 'बंद करें', en: 'Close menu' },
  'nav.newChat': { hi: 'नई बातचीत', en: 'New chat' },
  'nav.recent': { hi: 'पिछली बातचीत', en: 'Recent' },
  'nav.monitored': { hi: 'निगरानी', en: 'Monitored' },
  'nav.untitled': { hi: 'नई बातचीत', en: 'New chat' },
  'nav.rename': { hi: 'नाम बदलें', en: 'Rename' },
  'nav.delete': { hi: 'मिटाएँ', en: 'Delete' },
  'nav.actionsFor': { hi: '{name} के लिए विकल्प', en: 'Actions for {name}' },
  'nav.conversationName': { hi: 'बातचीत का नाम', en: 'Conversation name' },

  'recents.emptySignedOut': {
    hi: 'बातचीत सहेजने के लिए साइन इन करें। बिना खाते के यह बातचीत सिर्फ़ इस टैब तक रहती है।',
    en: 'Sign in to keep your chats. Without an account this conversation lasts as long as the tab.',
  },
  'recents.empty': {
    hi: 'अभी कुछ नहीं। कुछ पूछें।',
    en: 'Nothing yet. Ask something.',
  },

  /* ---- the conversation ------------------------------------------ */
  'chat.log': { hi: 'बातचीत', en: 'Conversation' },
  'chat.thinking': { hi: 'सोच रहे हैं…', en: 'Thinking…' },
  'chat.opening': { hi: 'बातचीत खुल रही है…', en: 'Opening…' },
  'chat.locating': { hi: 'जगह पता कर रहे हैं…', en: 'Finding you…' },
  'chat.subtitle': {
    hi: 'मौसम, पूर्वानुमान या चेतावनी के बारे में पूछें।',
    en: 'Ask about the weather, forecast, or warnings.',
  },
  'chat.provenanceNote': {
    hi: 'हर आँकड़े के साथ उसका स्रोत और जारी होने का समय रहता है।',
    en: 'Every number comes with its source and the time it was issued.',
  },
  'chat.you': { hi: 'आप', en: 'You' },
  'chat.assistant': { hi: 'चातक', en: 'Chaatak' },
  'chat.youSaid': { hi: 'आपने कहा', en: 'You said' },
  'chat.assistantSaid': { hi: 'चातक ने कहा', en: 'Chaatak replied' },
  'chat.using': { hi: '{place} की जानकारी', en: 'Using {place}' },

  'chat.useMyLocation': { hi: 'मेरी जगह इस्तेमाल करें', en: 'Use my location' },
  'chat.jumpToLatest': { hi: 'नीचे जाएँ', en: 'Jump to latest' },

  'composer.placeholder': { hi: 'कुछ भी पूछें…', en: 'Ask anything…' },
  'composer.label': { hi: 'मौसम के बारे में पूछें', en: 'Ask about the weather' },
  'composer.send': { hi: 'भेजें', en: 'Send' },
  'composer.stopSpeaking': { hi: 'बोलना बंद करें', en: 'Stop speaking' },

  /* ---- absence and staleness ------------------------------------- */
  'offline.nothingSaved': { hi: 'कोई सहेजी गई जानकारी नहीं', en: 'Nothing saved' },
  'offline.nothingSavedBody': {
    hi: 'आप ऑफ़लाइन हैं और कोई पुरानी जानकारी सहेजी नहीं है। इंटरनेट आने पर फिर पूछें।',
    en: 'You are offline and nothing was saved earlier. Ask again when you have a connection.',
  },

  'stale.expired': { hi: 'चेतावनी की अवधि बीत चुकी है', en: 'Warning expired' },
  'stale.expiredBody': {
    hi: 'यह चेतावनी {time} बजे तक की थी और अब लागू नहीं है।',
    en: 'This warning ran until {time} and is no longer in force.',
  },
  'stale.expiredBodyOffline': {
    hi: 'यह चेतावनी {time} बजे तक की थी और अब लागू नहीं है। आप ऑफ़लाइन हैं, इसलिए अभी की जानकारी नहीं बता सकते।',
    en: 'This warning ran until {time} and is no longer in force. You are offline, so we cannot tell you what is current.',
  },
  'stale.saved': { hi: 'पुरानी जानकारी', en: 'Saved' },
  'stale.offline': { hi: 'ऑफ़लाइन', en: 'Offline' },
  'stale.body': { hi: 'यह {age} की जानकारी है।', en: 'This is from {age}.' },
  'stale.bodyOffline': {
    hi: 'आप ऑफ़लाइन हैं। यह {age} की जानकारी है।',
    en: 'You are offline. This is from {age}.',
  },

  /* ---- the weather rail -------------------------------------------- */
  'rail.title': { hi: 'मौसम', en: 'Weather' },
  'rail.emptyHeadline': { hi: 'अभी कोई जगह नहीं', en: 'No location yet' },
  'rail.emptyBody': {
    hi: 'किसी जगह के बारे में पूछें, या अपनी जगह इस्तेमाल करें।',
    en: 'Ask about a place, or use your location.',
  },
  'rail.loading': { hi: 'मौसम आ रहा है…', en: 'Loading weather…' },
  'rail.failed': {
    hi: 'मौसम अभी नहीं मिल सका। थोड़ी देर बाद देखें।',
    en: 'Weather could not be loaded. Try again shortly.',
  },
  'rail.feelsLike': { hi: 'महसूस', en: 'Feels like' },
  'rail.high': { hi: 'अधिकतम', en: 'High' },
  'rail.low': { hi: 'न्यूनतम', en: 'Low' },
  'rail.humidity': { hi: 'नमी', en: 'Humidity' },
  'rail.wind': { hi: 'हवा', en: 'Wind' },
  'rail.precipitation': { hi: 'बारिश', en: 'Precipitation' },
  'rail.temperature': { hi: 'तापमान', en: 'Temperature' },
  'rail.aqi': { hi: 'हवा की गुणवत्ता', en: 'Air quality' },
  'rail.monitor': { hi: '{place} की चेतावनी देखें', en: 'Monitor {place} alerts' },
  'rail.monitored': { hi: '{place} निगरानी में है', en: '{place} is monitored' },
  'rail.monitorHint': {
    hi: 'IMD की आधिकारिक चेतावनियाँ, इस ज़िले के लिए।',
    en: 'Official IMD warnings for this district.',
  },
  'rail.monitorSignIn': {
    hi: 'जगह सहेजने के लिए साइन इन करें।',
    en: 'Sign in to save places.',
  },
  'rail.unavailable': {
    hi: 'इस समय का आँकड़ा उपलब्ध नहीं है।',
    en: 'No current reading is available.',
  },
  'rail.staleNotice': {
    hi: 'यह {age} पुराना आँकड़ा है, अभी का नहीं।',
    en: 'This is from {age} ago, not right now.',
  },
  'rail.aqiModelled': {
    hi: 'मॉडल से निकाला गया · यूरोपीय सूचकांक (CAMS)। यह CPCB का आधिकारिक AQI नहीं है।',
    en: 'Modelled · European index (CAMS). Not the official CPCB AQI.',
  },
  'rail.aqiUnavailable': {
    hi: 'हवा की गुणवत्ता उपलब्ध नहीं है।',
    en: 'Air quality is not available.',
  },
  'rail.openMap': { hi: 'मौसम का नक्शा', en: 'Weather map' },

  /* ---- the map ------------------------------------------------------ */
  'map.cloud': { hi: 'बादल', en: 'Cloud' },
  'map.uv': { hi: 'यूवी', en: 'UV' },
  'map.pressure': { hi: 'दबाव', en: 'Pressure' },
  'map.alerts': { hi: 'चेतावनी', en: 'Alerts' },
  'map.noSource': {
    hi: 'इस परत के लिए कोई भरोसेमंद स्रोत नहीं है, इसलिए कुछ नहीं दिखाया जा रहा।',
    en: 'No authoritative source for this layer, so nothing is drawn.',
  },

  /*
   * Deliberately NOT map.noSource. That sentence says this layer can never be
   * drawn; this one says the source it does have did not answer just now. A
   * reader can act on the second and only give up on the first.
   */
  'map.unreachable': {
    hi: 'स्रोत ने अभी जवाब नहीं दिया। नक़्शा हिलाकर दोबारा कोशिश करें।',
    en: 'The source did not answer just now. Move the map to try again.',
  },

  /* ---- provenance -------------------------------------------------- */
  /* What KIND of value this is. It sits where an API path used to, because
     a visitor can act on "model" and cannot act on /api/v1/current_wx. */
  'provenance.issued': { hi: 'जारी', en: 'Issued' },
  'provenance.updated': { hi: 'अपडेट', en: 'Updated' },
  'provenance.valid': { hi: 'मान्य', en: 'Valid' },
  'provenance.checked': { hi: 'जाँचा', en: 'Checked' },
  'provenance.model': { hi: 'मॉडल', en: 'model' },
  'provenance.observation': { hi: 'मापा गया', en: 'observed' },
  'provenance.bulletin': { hi: 'बुलेटिन', en: 'bulletin' },

  /* ---- the microphone -------------------------------------------- */
  'mic.idle': { hi: 'बोलकर पूछें', en: 'Ask by voice' },
  'mic.listening': { hi: 'सुन रहे हैं…', en: 'Listening…' },
  'mic.processing': { hi: 'जाँच रहे हैं…', en: 'Checking…' },
  'mic.failed': { hi: 'सुनाई नहीं दिया', en: 'Not heard' },
  'mic.denied': { hi: 'माइक बंद है', en: 'Microphone off' },
  'mic.failedBody': {
    hi: 'कुछ सुनाई नहीं दिया। फिर से बोलें, या लिखकर पूछें।',
    en: 'Nothing was heard. Try again, or type your question.',
  },
  'mic.deniedBody': {
    hi: 'माइक की अनुमति नहीं है। नीचे लिखकर पूछें।',
    en: 'Microphone permission is off. Type your question below.',
  },

  /* ---- monitored places ------------------------------------------ */
  'places.count': { hi: '{used} / {limit}', en: '{used} of {limit}' },
  'places.inviteHeadline': {
    hi: 'तीन जगहें सहेजें और चेतावनी अपने आप पाएँ — इसके लिए साइन इन करें।',
    en: 'Save up to three places and be warned without asking. Needs an account.',
  },
  'places.alertsOn': { hi: 'चेतावनी चालू', en: 'Alerts on' },
  'places.alertsOff': { hi: 'सहेजा · चेतावनी बंद', en: 'Saved · alerts off' },
  'places.add': { hi: 'जोड़ें', en: 'Add' },
  'places.addPlaceholder': { hi: 'जगह जोड़ें', en: 'Add a place' },
  'places.addLabel': { hi: 'निगरानी के लिए जगह जोड़ें', en: 'Add a place to monitor' },
  'places.addHere': { hi: 'मैं जहाँ हूँ वह जोड़ें', en: 'Add where I am' },
  'places.remove': { hi: '{place} की निगरानी बंद करें', en: 'Stop monitoring {place}' },
  'places.full': {
    hi: 'तीन जगहों तक ही रख सकते हैं। नई जोड़ने के लिए एक हटाएँ।',
    en: 'Three places is the limit. Remove one to add another.',
  },
  'places.duplicate': {
    hi: '{district} पहले से {place} में शामिल है।',
    en: '{district} is already covered by {place}.',
  },
  'places.geoDenied': {
    hi: 'इस साइट के लिए जगह की अनुमति बंद है। जगह का नाम लिखें।',
    en: 'Location is blocked for this site. Type a place name instead.',
  },
  'places.geoFailed': {
    hi: 'आपकी जगह पता नहीं चल सकी। जगह का नाम लिखें।',
    en: 'Could not get a location fix. Type a place name instead.',
  },

  /* ---- alerts ----------------------------------------------------- */
  'alerts.heading': { hi: 'चेतावनी सूचना', en: 'Alert notifications' },
  'alerts.on': { hi: 'इस खाते पर चेतावनी चालू', en: 'Alerts on for this account' },
  'alerts.off': { hi: 'चेतावनी बंद', en: 'Alerts off' },
  'alerts.enable': { hi: 'इन जगहों की चेतावनी भेजें', en: 'Warn me about these places' },
  'alerts.enabling': { hi: 'पूछ रहे हैं…', en: 'Asking…' },
  'alerts.disable': { hi: 'इस डिवाइस पर बंद करें', en: 'Turn off on this device' },
  'alerts.unsupported': {
    hi: 'यहाँ सूचनाएँ उपलब्ध नहीं हैं। सहेजी जगहें फिर भी काम करती हैं — चेतावनी देखने के लिए चातक खोलें।',
    en: 'Push notifications are not available here. Saved places still work — open Chaatak to see their warnings.',
  },
  'alerts.blocked': {
    hi: 'ब्राउज़र की सेटिंग में इस साइट की सूचनाएँ बंद हैं। सहेजी जगहें फिर भी काम करती हैं — चेतावनी देखने के लिए चातक खोलें।',
    en: 'Notifications are blocked for this site in your browser settings. Saved places still work; open Chaatak to see their warnings.',
  },
  'alerts.deniedNow': {
    hi: 'इस साइट के लिए सूचनाएँ बंद हैं। आपकी जगहें फिर भी सहेजी हैं।',
    en: 'Notifications are blocked for this site. Your places are still saved.',
  },
  'alerts.unavailable': {
    hi: 'इस साइट पर सूचनाएँ अभी उपलब्ध नहीं हैं।',
    en: 'Push is not configured on this deployment.',
  },
  'alerts.failed': {
    hi: 'चेतावनी चालू नहीं हो सकी। फिर कोशिश करें।',
    en: 'Could not switch alerts on. Try again.',
  },

  /* ---- account ---------------------------------------------------- */
  'account.signIn': { hi: 'Google से साइन इन करें', en: 'Sign in with Google' },
  'account.why': {
    hi: 'आपकी बातचीत और तीन निगरानी वाली जगहें, हर डिवाइस पर।',
    en: 'Keeps your chats and up to three monitored places, on every device.',
  },
  'account.signInFailed': {
    hi: 'साइन इन पूरा नहीं हुआ। फिर कोशिश करें।',
    en: 'Sign-in did not complete. Try again.',
  },
  'account.signInUnavailable': {
    hi: 'इस साइट पर खाते अभी चालू नहीं हैं।',
    en: 'Accounts are not configured on this deployment.',
  },
  'account.signedIn': { hi: 'साइन इन', en: 'Signed in' },
  'account.menu': { hi: 'खाता', en: 'Account' },
  'account.signOut': { hi: 'साइन आउट', en: 'Sign out' },
  'account.deleteAll': { hi: 'सारी बातचीत मिटाएँ', en: 'Delete all chats' },
  'account.delete': { hi: 'खाता मिटाएँ', en: 'Delete account' },
  'account.deleteFailed': {
    hi: 'खाता मिट नहीं सका।',
    en: 'Could not delete the account.',
  },

  /* ---- confirmations ---------------------------------------------- */
  'confirm.cancel': { hi: 'रहने दें', en: 'Cancel' },

  'confirm.signOut.headline': { hi: 'साइन आउट करें?', en: 'Sign out?' },
  'confirm.signOut.body': {
    hi: 'आपकी बातचीत और जगहें सुरक्षित रहेंगी। दोबारा साइन इन करने पर फिर मिल जाएँगी।',
    en: 'Your chats and monitored places stay safe. They are here again when you sign back in.',
  },
  'confirm.signOut.confirm': { hi: 'साइन आउट', en: 'Sign out' },

  'confirm.deleteChat.headline': { hi: 'यह बातचीत मिटाएँ?', en: 'Delete this chat?' },
  'confirm.deleteChat.body': {
    hi: 'इस बातचीत के सारे संदेश हमेशा के लिए मिट जाएँगे।',
    en: 'Every message in this conversation goes, permanently.',
  },
  'confirm.deleteChat.confirm': { hi: 'मिटाएँ', en: 'Delete' },

  'confirm.deleteAll.headline': { hi: 'सारी बातचीत मिटाएँ?', en: 'Delete all chats?' },
  'confirm.deleteAll.body': {
    hi: 'हर बातचीत और उसके सारे संदेश हमेशा के लिए मिट जाएँगे। निगरानी वाली जगहें और चेतावनियाँ वैसी ही रहेंगी।',
    en: 'Every conversation and all its messages go, permanently. Your monitored places and alerts are not affected.',
  },
  'confirm.deleteAll.confirm': { hi: 'सब मिटाएँ', en: 'Delete all' },

  'confirm.deleteAccount.headline': { hi: 'खाता मिटाएँ?', en: 'Delete account?' },
  'confirm.deleteAccount.body': {
    hi: 'बातचीत, संदेश, निगरानी वाली जगहें और चेतावनियाँ — सब हमेशा के लिए मिट जाएगा। यह वापस नहीं आ सकता।',
    en: 'Conversations, messages, monitored places and alerts are all deleted permanently. This cannot be undone.',
  },
  'confirm.deleteAccount.confirm': { hi: 'खाता मिटाएँ', en: 'Delete account' },

  /* ---- settings ---------------------------------------------------- */
  'settings.title': { hi: 'सेटिंग', en: 'Settings' },
  'settings.open': { hi: 'सेटिंग खोलें', en: 'Settings' },
  'settings.heading': { hi: 'भाषा', en: 'Language' },
  'settings.auto': { hi: 'अपने आप (डिवाइस)', en: 'Auto (device)' },
  'settings.autoAssistant': { hi: 'अपने आप', en: 'Auto' },
  'settings.ui': { hi: 'ऐप की भाषा', en: 'App language' },
  'settings.assistant': { hi: 'जवाब की भाषा', en: 'Assistant' },
  'settings.voice': { hi: 'आवाज़ की भाषा', en: 'Voice' },
  'settings.uiHint': {
    hi: 'अपने आप चुनने पर आपके डिवाइस की भाषा चलती है।',
    en: 'Auto follows your device’s language.',
  },
  'settings.assistantHint': {
    hi: 'अपने आप चुनने पर जवाब उसी भाषा और लिपि में आता है जिसमें आपने पूछा।',
    en: 'Auto replies in whichever language and script you asked in.',
  },
  'settings.voiceHint': {
    hi: 'अपने आप चुनने पर आवाज़ आपकी बाकी भाषा के साथ चलती है।',
    en: 'Auto follows your other language choices.',
  },
  'settings.uiBorrowed': {
    hi: 'चातक की स्क्रीन अभी {language} में नहीं है, इसलिए यह {shown} में दिख रही है। जवाब और आवाज़ फिर भी आपकी चुनी भाषा में आएँगे।',
    en: 'Chaatak’s screens are not in {language} yet, so they are shown in {shown}. Answers and voice still come in the language you chose.',
  },
  'settings.taxonomyBorrowed': {
    hi: 'चेतावनी के आधिकारिक स्तर अंग्रेज़ी में ही रहते हैं — वे हाथ से अनुवाद किए जाते हैं, मशीन से कभी नहीं।',
    en: 'Official warning levels stay in English — translated by hand, never by machine.',
  },
  'settings.theme': { hi: 'रंग-रूप', en: 'Appearance' },

  /* ---- errors ------------------------------------------------------ */
  'error.generic': { hi: 'कुछ गड़बड़ हुई। फिर कोशिश करें।', en: 'Something went wrong. Try again.' },
} as const satisfies Record<string, Entry>;

export type StringKey = keyof typeof STRINGS;

/** The values a string may have spliced into it. Never a weather value. */
export type Vars = Record<string, string | number>;

/**
 * One string, in one language.
 *
 * A missing key is a programming error and shows the key itself rather than
 * an empty space — a blank label is invisible in review and a key is not.
 */
export function translate(
  key: StringKey,
  lang: InterfaceLang,
  vars?: Vars,
): string {
  const entry = STRINGS[key] as Entry | undefined;
  if (!entry) return key;

  const text = entry[lang] ?? entry.en ?? key;
  if (!vars) return text;

  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}

/** A `t` bound to one language, for a component that renders in it. */
export function translator(lang: InterfaceLang) {
  return (key: StringKey, vars?: Vars) => translate(key, lang, vars);
}

export type Translate = ReturnType<typeof translator>;

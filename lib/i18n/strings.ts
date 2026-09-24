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
  /* The logo's name as a control: it goes home, to a fresh chat. */
  'nav.home': { hi: 'चातक — नई बातचीत', en: 'Chaatak — new chat' },
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
  'chat.suggestions': { hi: 'पूछने के लिए कुछ सवाल', en: 'Questions to start with' },
  'nav.skipToChat': { hi: 'सीधे बातचीत पर जाएँ', en: 'Skip to the conversation' },
  'nav.sidebar': { hi: 'बातचीत और जगहें', en: 'Chats and locations' },
  'nav.closeMenu': { hi: 'मेनू बंद करें', en: 'Close menu' },

  'composer.placeholder': { hi: 'कुछ भी पूछें…', en: 'Ask anything…' },
  'composer.label': { hi: 'मौसम के बारे में पूछें', en: 'Ask about the weather' },
  'composer.send': { hi: 'भेजें', en: 'Send' },

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
  'rail.metric': { hi: 'क्या दिखाएँ', en: 'Show' },
  'rail.noWarning': { hi: 'IMD की कोई चेतावनी लागू नहीं', en: 'No IMD warning in force' },
  'rail.warningsUnavailable': {
    hi: 'IMD की चेतावनियाँ अभी उपलब्ध नहीं हैं।',
    en: 'IMD warnings are not available right now.',
  },
  'rail.moreWarnings': { hi: '{count} और चेतावनियाँ', en: '{count} more warnings' },

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
  'map.layers': { hi: 'नक़्शे की परतें', en: 'Map layers' },
  'map.summary': {
    hi: '{layer}: दिख रहे हिस्से में {min} से {max} {unit} ({count} जगहों के आँकड़े)।',
    en: '{layer} in view: {min} to {max} {unit}, from {count} points.',
  },
  'map.readCentre': { hi: 'बीच की जगह का मान पढ़ें', en: 'Read the value at the centre' },
  'map.keyboardHint': {
    hi: 'नक़्शे पर जाकर तीर वाली कुंजियों से हिलाएँ, + और − से पास-दूर करें।',
    en: 'Focus the map, then use the arrow keys to move and + and − to zoom.',
  },
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
  /* A past series ends somewhere; nothing about it was "issued". */
  'provenance.through': { hi: 'तक का आँकड़ा', en: 'Data to' },
  'provenance.model': { hi: 'मॉडल', en: 'model' },
  'provenance.observation': { hi: 'मापा गया', en: 'observed' },
  'provenance.bulletin': { hi: 'बुलेटिन', en: 'bulletin' },
  /* Modelled pasts, named apart: neither is a rain gauge. */
  'provenance.archivedForecast': { hi: 'मॉडल रिकॉर्ड', en: 'model archive' },
  'provenance.reanalysis': { hi: 'पुनर्विश्लेषण', en: 'reanalysis' },
  /* The accessible sentence the provenance line is read as. */
  'provenance.sourceLabel': { hi: 'स्रोत', en: 'Source' },

  /* ---- the microphone -------------------------------------------- */
  'mic.denied': { hi: 'माइक बंद है', en: 'Microphone off' },

  /* ---- the voice session ------------------------------------------- */
  /* A conversation held by talking: started once, ended with Stop. Each
     state is said in words, because a pulsing ring says nothing to a
     screen reader, to someone who has turned animation off, or in sunlight. */
  'voice.start': { hi: 'बोलकर बात करें', en: 'Talk to Chaatak' },
  'voice.stop': { hi: 'बोलना बंद करें', en: 'Stop voice' },
  /* The button's name while someone is being heard: it sends now. */
  'voice.send': { hi: 'अभी भेजें', en: 'Send now' },
  'voice.requesting': { hi: 'माइक की अनुमति दें…', en: 'Allow the microphone…' },
  'voice.listening': { hi: 'सुन रहे हैं — बोलिए', en: 'Listening — just speak' },
  'voice.hearing': { hi: 'सुन रहे हैं — भेजने के लिए दबाएँ', en: 'Hearing you — tap to send' },
  'voice.processing': { hi: 'जाँच रहे हैं…', en: 'Checking…' },
  'voice.speaking': { hi: 'बोल रहे हैं — रोकने के लिए दबाएँ', en: 'Speaking — tap to stop' },
  'voice.stopped': { hi: 'आवाज़ बंद', en: 'Voice off' },
  'voice.notHeard': { hi: 'सुनाई नहीं दिया — फिर से बोलिए', en: 'Didn’t catch that — say it again' },
  /* The recogniser did not answer — not the same as hearing nothing, and not
     said as if it were: the person did nothing wrong. */
  'voice.retry': {
    hi: 'आवाज़ सेवा ने जवाब नहीं दिया — फिर से बोलिए',
    en: 'The voice service didn’t answer — say it again',
  },
  /* The session ended itself after a long silence, and let go of the mic. */
  'voice.idleStopped': {
    hi: 'कुछ देर कोई नहीं बोला, इसलिए माइक बंद कर दिया',
    en: 'Nobody spoke for a while, so the microphone is off',
  },
  'voice.deniedBody': {
    hi: 'माइक की अनुमति बंद है। ब्राउज़र की साइट सेटिंग में अनुमति दें, या नीचे लिखकर पूछें।',
    en: 'Microphone permission is off. Allow it in your browser’s site settings, or type your question below.',
  },
  'voice.noMicrophoneBody': {
    hi: 'कोई माइक नहीं मिला। नीचे लिखकर पूछें।',
    en: 'No microphone was found. Type your question below.',
  },
  'voice.failedBody': {
    hi: 'सुनते समय कुछ गड़बड़ हुई। फिर से कोशिश करने के लिए माइक दबाएँ, या लिखकर पूछें।',
    en: 'Something went wrong while listening. Tap the microphone to try again, or type.',
  },
  'voice.auto': { hi: 'भाषा अपने आप पहचानी जाती है', en: 'Language detected automatically' },
  'voice.in': { hi: '{language} में सुन रहे हैं', en: 'Listening in {language}' },
  /* The browser's own recogniser cannot detect a language, so it is told
     which one to expect — and the person is told which one that is. */
  'voice.fallback': {
    hi: 'इस ब्राउज़र में भाषा अपने आप नहीं पहचानी जाती — {language} में सुन रहे हैं।',
    en: 'This browser cannot detect the language — listening in {language}.',
  },
  'voice.level': { hi: 'आवाज़ का स्तर', en: 'Input level' },

  /* ---- questions and answers (/faq) --------------------------------- */
  /* Plain statements of how Chaatak works, each one true of the code as it
     stands. Severity wording is the catalogue's own (lib/alerts/templates),
     never paraphrased. A blank line in an answer starts a new paragraph. */
  'faq.link': { hi: 'सवाल-जवाब', en: 'FAQ' },
  'faq.title': { hi: 'सवाल और जवाब', en: 'Questions and answers' },
  'faq.intro': {
    hi: 'चातक कैसे काम करता है, मौसम की जानकारी कहाँ से आती है, और आपकी दी हुई जानकारी का क्या होता है।',
    en: 'How Chaatak works, where its weather comes from, and what happens to what you tell it.',
  },
  'faq.back': { hi: 'चातक पर लौटें', en: 'Back to Chaatak' },
  'faq.contents': { hi: 'इस पेज पर', en: 'On this page' },

  'faq.g.about': { hi: 'परिचय', en: 'About' },
  'faq.g.data': { hi: 'मौसम और स्रोत', en: 'Weather and sources' },
  'faq.g.warnings': { hi: 'चेतावनियाँ', en: 'Warnings' },
  'faq.g.voice': { hi: 'आवाज़ और भाषाएँ', en: 'Voice and languages' },
  'faq.g.privacy': { hi: 'निजता और आपका डेटा', en: 'Privacy and your data' },
  'faq.g.limits': { hi: 'सीमाएँ', en: 'Limits' },

  'faq.q.what': { hi: 'चातक क्या है?', en: 'What is Chaatak?' },
  'faq.a.what': {
    hi: 'चातक भारत मौसम विज्ञान विभाग (IMD) की आधिकारिक चेतावनियाँ और आपकी जगह का मौसम आपकी अपनी भाषा में बताता है — बोलकर या लिखकर। मौसम के बारे में पूछिए, या यह कि आज खेत में छिड़काव, सफ़र या क्रिकेट के लिए दिन ठीक है या नहीं — यह पूर्वानुमान देखकर जवाब देता है।\n\nइसे टीम Overcast ने स्मार्ट इंडिया हैकथॉन 2026 में, पहले से चेतावनी देने की IMD की समस्या के लिए बनाया है।',
    en: 'Chaatak tells you the India Meteorological Department’s (IMD) official warnings, and the weather where you are, in your own language — by voice or by typing. Ask about the weather, or whether today is good for spraying a field, travelling or playing cricket, and it answers from the forecast.\n\nIt was built by Team Overcast for Smart India Hackathon 2026, for IMD’s problem statement on early warnings.',
  },
  'faq.q.account': { hi: 'क्या खाता बनाना ज़रूरी है?', en: 'Do I need an account?' },
  'faq.a.account': {
    hi: 'नहीं। कोई भी पूछ सकता है और जवाब पा सकता है। Google से साइन इन करने पर आपकी बातचीत सहेजी जाती है, और आप तीन जगहें सहेजकर उनकी चेतावनियाँ अपने आप पा सकते हैं।',
    en: 'No. Anyone can ask and get an answer. Signing in with Google keeps your chats, and lets you save up to three places and receive their warnings automatically.',
  },

  'faq.q.sources': { hi: 'मौसम की जानकारी कहाँ से आती है?', en: 'Where does the weather come from?' },
  'faq.a.sources': {
    hi: 'चेतावनियाँ IMD से आती हैं, आपके ज़िले के लिए। अभी का मौसम और पूर्वानुमान Open-Meteo से आते हैं, जो एक मौसम-मॉडल सेवा है, और इन्हें “मॉडल” लिखकर दिखाया जाता है। हर जवाब के नीचे उसका स्रोत और जारी होने का समय लिखा होता है।',
    en: 'Warnings come from IMD, for your district. The current weather and the forecast come from Open-Meteo, a weather-model service, and are marked as model values. Every answer shows its source and the time it was issued on the line beneath it.',
  },
  'faq.q.ai': { hi: 'क्या AI आंकड़े खुद बना देता है?', en: 'Does the AI make up the numbers?' },
  'faq.a.ai': {
    hi: 'नहीं। AI आंकड़ों के आस-पास वाक्य लिखता है; कोई आंकड़ा खुद नहीं बनाता। जवाब दिखाने से पहले उसके हर आंकड़े को डेटा से मिलाया जाता है। अगर मेल नहीं खाता, तो चातक पहले से लिखा हुआ सीधा जवाब दिखाता है।',
    en: 'No. The AI writes the sentence around the numbers; it never produces a number itself. Every number in an answer is checked against the data before the answer is shown, and if the check fails Chaatak shows a plain pre-written answer instead.',
  },
  'faq.q.nature': {
    hi: '“मॉडल”, “मापा गया” और “बुलेटिन” का क्या मतलब है?',
    en: 'What do “model”, “observed” and “bulletin” mean?',
  },
  'faq.a.nature': {
    hi: '“मॉडल” यानी मौसम-मॉडल से निकाला गया अनुमान — यह किसी वर्षामापी की रीडिंग नहीं है। “मापा गया” यानी किसी मौसम स्टेशन ने इसे मापा है। “बुलेटिन” यानी यह IMD की आधिकारिक चेतावनी है। चातक हमेशा बताता है कि आप इनमें से कौन-सी जानकारी देख रहे हैं।',
    en: '“Model” means a value computed by a weather model — an estimate, not a reading from a rain gauge. “Observed” means a weather station measured it. “Bulletin” means it is IMD’s official warning. Chaatak always says which of these you are looking at.',
  },
  'faq.q.nodata': { hi: 'अगर मेरे इलाके का डेटा न हो तो?', en: 'What if there is no data for my area?' },
  'faq.a.nodata': {
    hi: 'चातक साफ़ बता देता है। यह पास के ज़िले के आंकड़े नहीं लेता, और न ही अंदाज़ा लगाता है।',
    en: 'Chaatak says so plainly. It does not borrow a neighbouring district’s numbers, and it does not guess.',
  },
  'faq.q.aqi': { hi: 'क्या हवा की गुणवत्ता भारत का आधिकारिक AQI है?', en: 'Is the air quality India’s official AQI?' },
  'faq.a.aqi': {
    hi: 'नहीं। दिखाई गई हवा की गुणवत्ता यूरोपीय पैमाने पर मॉडल से निकला मान है। भारत का आधिकारिक सूचकांक CPCB का है, जो स्टेशनों पर अलग पैमाने से मापा जाता है — दोनों की तुलना नहीं की जा सकती। स्क्रीन पर लिखा होता है कि यह कौन-सा है।',
    en: 'No. The air quality shown is a modelled value on the European scale. India’s official index is CPCB’s, measured at stations on different breakpoints, and the two cannot be compared. The screen says which one it is.',
  },

  'faq.q.colours': { hi: 'चेतावनी के रंगों का क्या मतलब है?', en: 'What do the warning colours mean?' },
  'faq.a.colours': {
    hi: 'ये IMD के रंग हैं। हरा — कोई चेतावनी नहीं। पीली चेतावनी — सतर्क रहें। नारंगी चेतावनी — तैयार रहें। लाल चेतावनी — तुरंत कार्रवाई करें।\n\nरंग हमेशा शब्दों में भी लिखा होता है, ताकि तेज़ धूप में या रंग न पहचान पाने पर भी पढ़ा जा सके।',
    en: 'They are IMD’s. Green — no warning. Yellow warning — be aware. Orange warning — be prepared. Red warning — take action now.\n\nThe colour is always written out in words too, so it can be read in bright sun or without colour vision.',
  },
  'faq.q.automatic': { hi: 'क्या बिना पूछे चेतावनी मिल सकती है?', en: 'Can I get warnings without asking?' },
  'faq.a.automatic': {
    hi: 'हाँ। साइन इन करें, तीन जगहें तक सहेजें, और इस डिवाइस पर सूचनाएँ चालू करें या Telegram जोड़ें। जब IMD आपके किसी ज़िले के लिए चेतावनी जारी करता है, तो वह आपके पास अपने आप पहुँचती है — और अगर IMD उसे समय से पहले वापस ले लेता है, तो वह भी बताया जाता है।',
    en: 'Yes. Sign in, save up to three places, and turn on notifications on this device or link Telegram. When IMD issues a warning for one of your districts it reaches you by itself — and if IMD withdraws it early, you are told that too.',
  },
  'faq.q.district': { hi: 'क्या चेतावनी ठीक मेरे गाँव के लिए होती है?', en: 'Is a warning for my exact village?' },
  'faq.a.district': {
    hi: 'IMD चेतावनियाँ ज़िले के हिसाब से जारी करता है, इसलिए एक चेतावनी पूरे ज़िले पर लागू होती है। चातक वही ज़िला दिखाता है, और कोई ऐसी सीमा नहीं बनाता जो IMD ने जारी न की हो।',
    en: 'IMD issues warnings by district, so a warning covers the whole district. Chaatak shows the district it applies to, and never draws a boundary IMD did not publish.',
  },

  'faq.q.voice': { hi: 'बोलकर पूछना कैसे काम करता है?', en: 'How does voice work?' },
  'faq.a.voice': {
    hi: 'माइक दबाइए और बोलिए। बोलना रुकते ही सवाल अपने आप चला जाता है — या तुरंत भेजने के लिए दोबारा दबाइए। जवाब पढ़कर सुनाया जाता है, और फिर चातक अगला सवाल सुनने लगता है। किसी भी समय रोकने के लिए बटन दबाइए।\n\nआवाज़ को भाषिणी (Bhashini) पहचानता है, जो भारत सरकार का भाषा मंच है। अगर भाषिणी तक पहुँच न हो, तो आपके ब्राउज़र की अपनी आवाज़-पहचान इस्तेमाल होती है।',
    en: 'Tap the microphone and speak. When you stop, your question goes by itself — or tap again to send it straight away. The answer is read aloud, and then Chaatak listens for your next question. Tap the button to stop at any time.\n\nSpeech is recognised by Bhashini, the Government of India’s language platform. If Bhashini cannot be reached, your browser’s own speech recognition is used instead.',
  },
  'faq.q.languages': { hi: 'किन भाषाओं में पूछ सकते हैं?', en: 'Which languages can I use?' },
  'faq.a.languages': {
    hi: 'हिंदी, अंग्रेज़ी, मराठी, बांग्ला, गुजराती, तमिल और पंजाबी में — और हिंग्लिश में भी — पूछ सकते हैं और जवाब सुन सकते हैं। चातक उसी भाषा और लिपि में जवाब देता है जिसमें आपने पूछा। स्क्रीन पर लिखा हुआ अभी हिंदी और अंग्रेज़ी में है।\n\nभोजपुरी, अवधी, हरियाणवी और राजस्थानी जैसी बोलियाँ समझ में आती हैं, और जवाब मानक हिंदी में दिया जाता है।',
    en: 'You can ask and hear answers in Hindi, English, Marathi, Bengali, Gujarati, Tamil and Punjabi — and in Hinglish. Chaatak replies in the language and script you used. The screens themselves are in Hindi and English for now.\n\nIt understands dialects such as Bhojpuri, Awadhi, Haryanvi and Rajasthani, and replies in standard Hindi.',
  },

  'faq.q.recording': { hi: 'मेरी आवाज़ की रिकॉर्डिंग का क्या होता है?', en: 'What happens to my voice recording?' },
  'faq.a.recording': {
    hi: 'यह चातक के सर्वर से होकर भाषिणी को भेजी जाती है ताकि इसे शब्दों में बदला जा सके, और चातक इसे अपने पास नहीं रखता। माइक सिर्फ़ तब चालू रहता है जब आप चातक से बात कर रहे हों — जवाब सुनाते समय, रोकने पर, और तीस सेकंड तक चुप्पी रहने पर यह बंद हो जाता है।',
    en: 'It is sent through Chaatak’s server to Bhashini to be turned into text, and Chaatak does not keep it. The microphone is on only while you are talking to Chaatak — it switches off while the answer is read out, when you tap stop, and after thirty seconds of silence.',
  },
  'faq.q.location': { hi: 'क्या चातक मेरी लोकेशन पर नज़र रखता है?', en: 'Does Chaatak track my location?' },
  'faq.a.location': {
    hi: 'नहीं। लोकेशन सिर्फ़ तब माँगी जाती है जब किसी सवाल के लिए जगह चाहिए और आपने जगह का नाम नहीं बताया — और आप हमेशा मना करके जगह का नाम लिख सकते हैं। इससे सिर्फ़ आपका शहर या कस्बा पता किया जाता है, फिर लोकेशन हटा दी जाती है: चातक शहर का नाम रखता है, आपकी सटीक जगह नहीं।',
    en: 'No. Your location is asked for only when a question needs a place and you did not name one — and you can always say no and type a place instead. It is used to find your town and then discarded: Chaatak keeps the town, not your exact position.',
  },
  'faq.q.stored': { hi: 'क्या सहेजा जाता है, और कहाँ?', en: 'What is stored, and where?' },
  'faq.a.stored': {
    hi: 'बिना साइन इन के, आपकी बातचीत सिर्फ़ इस ब्राउज़र टैब में रहती है और टैब बंद करते ही चली जाती है। साइन इन करने पर आपकी बातचीत, सहेजी गई जगहें और भाषा की सेटिंग आपके खाते में, भारत के सर्वरों पर, सहेजी जाती हैं। आप कभी भी कोई बातचीत मिटा सकते हैं, या खाते के मेनू से अपना खाता और उसमें सब कुछ मिटा सकते हैं।\n\nकुछ सवाल समझने और जवाब लिखने के लिए आपके सवाल का टेक्स्ट एक AI सेवा को भेजा जाता है। मौसम के आंकड़े कभी उससे नहीं आते।',
    en: 'As a guest, your chat stays in this browser tab and is gone when you close it. If you sign in, your chats, saved places and language settings are kept in your account, on servers in India. You can delete a chat at any time, or delete your account and everything in it from the account menu.\n\nTo understand some questions and write answers, the text of your question is sent to an AI service. The weather numbers never come from it.',
  },

  'faq.q.limits': { hi: 'किन बातों के लिए चातक पर निर्भर नहीं रहना चाहिए?', en: 'What should I not rely on Chaatak for?' },
  'faq.a.limits': {
    hi: 'पूर्वानुमान पूरे दिन का होता है, घंटे-घंटे का नहीं — इसलिए “कल शाम” के सवाल का जवाब पूरे दिन के आंकड़ों से दिया जाता है। चेतावनियाँ पूरे ज़िले के लिए होती हैं। मॉडल के मान बाहर दिख रहे मौसम से अलग हो सकते हैं। बहुत शोर वाली जगह पर आवाज़ ग़लत सुनी जा सकती है — आप हमेशा लिखकर पूछ सकते हैं।\n\nचातक कोई आपातकालीन सेवा नहीं है। ख़तरे में अपने स्थानीय प्रशासन और IMD के निर्देश मानें, और 112 पर कॉल करें।',
    en: 'Forecasts are for a whole day, not hour by hour, so an answer about “tomorrow evening” reasons from the day’s figures. Warnings cover whole districts. Model values can differ from what you see outside. In a very noisy place speech can be misheard — you can always type.\n\nChaatak is not an emergency service. In danger, follow your local administration and IMD, and call 112.',
  },
  'faq.q.offline': { hi: 'क्या यह बिना इंटरनेट के चलता है?', en: 'Does it work without the internet?' },
  'faq.a.offline': {
    hi: 'कुछ हद तक। चातक आखिरी जवाब सहेजकर रखता है और बिना इंटरनेट के उसे दिखाता है — यह बताते हुए कि वह कितना पुराना है। नया मौसम या नई चेतावनी इंटरनेट वापस आने पर ही मिल सकती है।',
    en: 'Partly. Chaatak keeps the last answer it gave and shows it offline, with how old it is. New weather and new warnings need the internet back.',
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
    hi: 'अपने आप चुनने पर आप जिस भाषा में बोलें, चातक वही पहचानकर उसी में जवाब देता है।',
    en: 'Auto recognises the language you speak and answers in it.',
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
  'theme.system': { hi: 'सिस्टम जैसा', en: 'Match system' },
  'theme.light': { hi: 'हल्का', en: 'Light' },
  'theme.dark': { hi: 'गहरा', en: 'Dark' },

  'alerts.enableDevice': {
    hi: 'इस डिवाइस पर भी सूचना दें',
    en: 'Notify this device too',
  },

  /* ---- Telegram, in settings ---------------------------------------- */
  'telegram.heading': { hi: 'टेलीग्राम', en: 'Telegram' },
  'telegram.pitch': {
    hi: 'अपनी सहेजी जगहों की IMD चेतावनियाँ टेलीग्राम में पाएँ, और वहीं मौसम भी पूछें।',
    en: 'Get IMD warnings for your saved places in Telegram, and ask about the weather there too.',
  },
  'telegram.connect': { hi: 'टेलीग्राम जोड़ें', en: 'Connect Telegram' },
  'telegram.preparing': { hi: 'लिंक बन रहा है…', en: 'Preparing a link…' },
  'telegram.open': { hi: 'टेलीग्राम खोलें', en: 'Open Telegram' },
  'telegram.waiting': {
    hi: 'टेलीग्राम में Start दबाएँ, फिर “जोड़ें”। यह लिंक एक ही बार चलेगा और {minutes} मिनट में ख़त्म हो जाएगा।',
    en: 'In Telegram, tap Start, then Connect. The link works once and expires in {minutes} minutes.',
  },
  'telegram.connected': { hi: 'जुड़ा हुआ', en: 'Connected' },
  'telegram.notConnected': { hi: 'नहीं जुड़ा', en: 'Not connected' },
  'telegram.connectedAs': { hi: '{name} के रूप में जुड़ा', en: 'Connected as {name}' },
  'telegram.alertsOn': {
    hi: 'आपकी सहेजी जगहों की चेतावनियाँ टेलीग्राम में आती हैं।',
    en: 'Warnings for your saved places arrive in Telegram.',
  },
  'telegram.alertsPaused': {
    hi: 'टेलीग्राम में चेतावनियाँ रुकी हैं। फिर शुरू करने के लिए बॉट को /alerts भेजें।',
    en: 'Alerts are paused in Telegram. Send /alerts to the bot to resume them.',
  },
  'telegram.disconnect': { hi: 'टेलीग्राम अलग करें', en: 'Disconnect Telegram' },
  'telegram.failed': { hi: 'लिंक नहीं बन सका। फिर कोशिश करें।', en: 'Could not make a link. Try again.' },
  'telegram.expired': { hi: 'वह लिंक ख़त्म हो गया। नया बनाएँ।', en: 'That link expired. Make a new one.' },
  'telegram.unavailable': {
    hi: 'इस साइट पर टेलीग्राम अभी चालू नहीं है।',
    en: 'Telegram is not set up on this deployment.',
  },
  'confirm.telegram.headline': { hi: 'टेलीग्राम अलग करें?', en: 'Disconnect Telegram?' },
  'confirm.telegram.body': {
    hi: 'टेलीग्राम में चेतावनियाँ आना बंद हो जाएँगी। आपकी सहेजी जगहें खाते में बनी रहेंगी।',
    en: 'Warnings will stop arriving in Telegram. Your saved places stay on your account.',
  },
  'confirm.telegram.confirm': { hi: 'अलग करें', en: 'Disconnect' },

  /*
   * ---- The Telegram bot ----------------------------------------------
   *
   * The bot is the assistant in another window, so its words live here with
   * everything else and follow the same rule: never machine-translated at
   * runtime. Severity words are NOT here — they come from the alert catalogue
   * in lib/alerts/templates.ts, exactly as every other alert's do.
   *
   * ⚠ Unlike the Hindi above, this section's Hindi is new with the bot, not
   * moved from an earlier screen. Have a native speaker read it before it is
   * relied on, as the rest of the catalogue was.
   */
  'tg.tagline': {
    hi: 'IMD की आधिकारिक चेतावनियाँ और मौसम, आपकी भाषा में।',
    en: 'Official IMD warnings and the weather, in your language.',
  },
  'tg.howToAsk': {
    hi: 'वैसे ही पूछें जैसे किसी इंसान से पूछते हैं:',
    en: 'Ask the way you would ask a person:',
  },
  'tg.examples': {
    hi: 'गाज़ियाबाद का मौसम\nकल बाराबंकी में बारिश होगी?\nपटना में कोई चेतावनी है?',
    en: 'weather in Ghaziabad\nwill it rain tomorrow in Barabanki?\nany warnings in Patna?',
  },
  'tg.tapHere': {
    hi: 'या अपनी जगह का मौसम जानने के लिए नीचे “{button}” दबाएँ।',
    en: 'Or tap “{button}” below for the weather where you are.',
  },
  'tg.connectInvite': {
    hi: 'बिना पूछे चेतावनी चाहिए? अपना चातक खाता जोड़ें — तीन सहेजी जगहों तक की IMD चेतावनियाँ यहीं आएँगी।',
    en: 'Want warnings before you have to ask? Connect your Chaatak account, and IMD warnings for up to three saved places arrive here.',
  },
  'tg.connectLink': { hi: 'chaatak.com पर खाता जोड़ें', en: 'Connect on chaatak.com' },
  'tg.connectedNote': {
    hi: 'आपका चातक खाता जुड़ा है। आपकी सहेजी जगहों की चेतावनियाँ यहीं आती हैं।',
    en: 'Connected to your Chaatak account. Warnings for your saved places arrive here.',
  },
  'tg.connectedPausedNote': {
    hi: 'आपका चातक खाता जुड़ा है। इस चैट में चेतावनियाँ रुकी हैं — फिर शुरू करने के लिए /alerts।',
    en: 'Connected to your Chaatak account. Alerts are paused in this chat — /alerts to resume.',
  },

  'tg.kb.here': { hi: '📍 यहाँ का मौसम', en: '📍 Weather here' },
  'tg.kb.places': { hi: '🔔 मेरी जगहें', en: '🔔 My places' },
  'tg.kb.placeholder': { hi: 'मौसम के बारे में पूछें…', en: 'Ask about the weather…' },

  'tg.cmd.weather': { hi: 'किसी जगह का मौसम', en: 'Weather for a place' },
  'tg.cmd.locations': { hi: 'आपकी सहेजी जगहें', en: 'Your saved places' },
  'tg.cmd.alerts': { hi: 'IMD चेतावनी सूचनाएँ', en: 'IMD warning alerts' },
  'tg.cmd.settings': { hi: 'खाता और जवाब की भाषा', en: 'Account and reply language' },
  'tg.cmd.help': { hi: 'कैसे पूछें', en: 'How to ask' },

  'tg.profile.short': {
    hi: 'भारत के लिए IMD की आधिकारिक मौसम चेतावनियाँ, आपकी भाषा में। किसी भी जगह का मौसम पूछें।',
    en: 'Official IMD weather warnings for India, in your language. Ask about any place.',
  },
  'tg.profile.description': {
    hi:
      'चातक भारत मौसम विज्ञान विभाग (IMD) की आधिकारिक चेतावनियाँ और मौसम आप तक आपकी भाषा में पहुँचाता है।\n\n' +
      '• भारत की किसी भी जगह का मौसम पूछें — “गाज़ियाबाद का मौसम”, “कल बारिश होगी?”\n' +
      '• अपनी जगह का मौसम जानने के लिए 📍 दबाएँ\n' +
      '• अपना चातक खाता जोड़ें और तीन जगहों तक की IMD चेतावनियाँ बिना पूछे पाएँ\n\n' +
      'हर आँकड़े के साथ उसका स्रोत और समय रहता है। चेतावनियाँ सिर्फ़ IMD से आती हैं।',
    en:
      'Chaatak brings the India Meteorological Department’s official warnings and the weather to you, in your language.\n\n' +
      '• Ask about any place in India — “weather in Ghaziabad”, “kal barish hogi?”\n' +
      '• Tap 📍 for the weather where you are\n' +
      '• Connect your Chaatak account to get IMD warnings for up to three places, before you ask\n\n' +
      'Every number shows its source and time. Warnings come only from IMD.',
  },

  'tg.help.sources': {
    hi: 'अभी का मौसम और पूर्वानुमान Open-Meteo नाम के मौसम मॉडल से आते हैं। चेतावनियाँ सिर्फ़ भारत मौसम विज्ञान विभाग (IMD) से आती हैं। हर आँकड़े के साथ उसका स्रोत और समय रहता है।',
    en: 'Current conditions and forecasts come from Open-Meteo, a weather model. Warnings come only from the India Meteorological Department. Every number shows its source and time.',
  },
  'tg.unknownCommand': { hi: 'यह कमांड मुझे नहीं पता।', en: 'I don’t know that command.' },
  'tg.unsupported': {
    hi: 'मैं लिखे हुए सवाल और भेजी गई जगह समझ सकता हूँ। सवाल लिखें, या अपनी जगह भेजने के लिए नीचे 📍 दबाएँ।',
    en: 'I can read typed questions and shared locations. Type your question, or tap 📍 below to share where you are.',
  },
  'tg.slowDown': {
    hi: 'एक साथ बहुत सारे संदेश आ गए। थोड़ा रुककर फिर पूछें।',
    en: 'That is a lot of messages at once. Wait a moment, then ask again.',
  },
  'tg.whichPlace': {
    hi: 'कौन सी जगह? उसका नाम लिखें, या नीचे 📍 दबाएँ।',
    en: 'Which place? Type its name, or tap 📍 below.',
  },
  'tg.orSaved': { hi: 'या अपनी कोई जगह चुनें:', en: 'Or pick one of your places:' },
  'tg.expired': { hi: 'यह बटन पुराना हो गया। फिर से पूछें।', en: 'That button has expired. Ask again.' },

  'tg.now': { hi: 'अभी', en: 'Now' },
  'tg.outlook': { hi: 'अगले तीन दिन', en: 'Next three days' },
  'tg.noWarning': { hi: 'IMD की कोई चेतावनी लागू नहीं', en: 'No IMD warning in force' },
  'tg.district': { hi: 'ज़िला {district}', en: '{district} district' },
  'tg.moreWarnings': { hi: 'कुल {count} चेतावनियाँ लागू', en: '{count} warnings in force' },

  'tg.btn.forecast': { hi: '📅 तीन दिन का पूर्वानुमान', en: '📅 Three-day forecast' },
  'tg.btn.refresh': { hi: '↻ ताज़ा करें', en: '↻ Refresh' },
  'tg.btn.open': { hi: 'चातक खोलें', en: 'Open Chaatak' },
  'tg.btn.details': { hi: 'मौसम और पूर्वानुमान', en: 'Weather and forecast' },
  'tg.btn.watch': { hi: '🔔 {place} की चेतावनी पाएँ', en: '🔔 Get alerts for {place}' },
  'tg.btn.watching': { hi: '✓ {place} निगरानी में', en: '✓ Watching {place}' },

  'tg.watch.added': {
    hi: '{place} अब निगरानी में है। इस ज़िले की IMD चेतावनियाँ यहाँ आएँगी।',
    en: 'Watching {place}. IMD warnings for this district will arrive here.',
  },
  'tg.watch.addedPaused': {
    hi: '{place} सहेज ली गई। इस चैट में चेतावनियाँ रुकी हैं — फिर शुरू करने के लिए /alerts।',
    en: 'Saved {place}. Alerts are paused in this chat — /alerts to resume.',
  },
  'tg.watch.needsAccount': {
    hi: 'सहेजी जगहों की चेतावनी के लिए चातक खाता चाहिए। खाता जोड़ें, तो तीन जगहों तक की चेतावनियाँ यहीं आएँगी।',
    en: 'Alerts for saved places need a Chaatak account. Connect yours, and warnings for up to three places arrive here.',
  },

  'tg.link.confirm': {
    hi: 'क्या इस टेलीग्राम को चातक खाते {account} से जोड़ें?',
    en: 'Connect this Telegram to the Chaatak account {account}?',
  },
  'tg.link.confirmBody': {
    hi: 'उस खाते की सहेजी जगहों की IMD चेतावनियाँ इस चैट में आएँगी। आप कभी भी इसे अलग कर सकते हैं।',
    en: 'IMD warnings for that account’s saved places will arrive in this chat. You can disconnect at any time.',
  },
  'tg.link.connect': { hi: 'जोड़ें', en: 'Connect' },
  'tg.link.done': {
    hi: 'जुड़ गया। आपकी सहेजी जगहों की IMD चेतावनियाँ अब यहाँ आएँगी।',
    en: 'Connected. IMD warnings for your saved places will arrive here.',
  },
  'tg.link.doneEmpty': {
    hi: 'जुड़ गया। अभी कोई जगह सहेजी नहीं है — किसी जगह का मौसम पूछें, फिर 🔔 दबाकर उसकी चेतावनी पाएँ।',
    en: 'Connected. No places are saved yet — ask about a place, then tap 🔔 to get its alerts.',
  },
  'tg.link.expired': {
    hi: 'यह लिंक पुराना हो गया है या पहले ही इस्तेमाल हो चुका है। चातक की सेटिंग में नया लिंक बनाएँ।',
    en: 'This link has expired or has already been used. Make a new one in Chaatak settings.',
  },
  'tg.link.otherAccount': {
    hi: 'यह टेलीग्राम किसी दूसरे चातक खाते से जुड़ा है। पहले /settings में उसे अलग करें।',
    en: 'This Telegram is connected to a different Chaatak account. Disconnect it in /settings first.',
  },
  'tg.link.already': {
    hi: 'यह टेलीग्राम पहले से उसी खाते से जुड़ा है।',
    en: 'This Telegram is already connected to that account.',
  },
  'tg.link.cancelled': { hi: 'नहीं जोड़ा गया। कुछ नहीं बदला।', en: 'Not connected. Nothing was changed.' },
  'tg.link.moved': {
    hi: 'यह टेलीग्राम अलग कर दिया गया — आपका चातक खाता किसी दूसरे टेलीग्राम से जोड़ा गया है। अगर यह आपने नहीं किया, तो chaatak.com पर साइन इन करके सेटिंग देखें।',
    en: 'This Telegram has been disconnected: your Chaatak account was connected to another Telegram. If that was not you, sign in on chaatak.com and check Settings.',
  },
  'tg.link.failed': {
    hi: 'अभी जोड़ा नहीं जा सका। लिंक फिर से आज़माएँ।',
    en: 'Could not connect just now. Try the link again.',
  },

  'tg.unlink.button': { hi: 'खाता अलग करें', en: 'Disconnect account' },
  'tg.unlink.confirm': {
    hi: 'इस टेलीग्राम को अपने चातक खाते से अलग करें? यहाँ चेतावनियाँ आना बंद हो जाएँगी। आपकी सहेजी जगहें खाते में बनी रहेंगी।',
    en: 'Disconnect this Telegram from your Chaatak account? Warnings will stop arriving here. Your saved places stay on the account.',
  },
  'tg.unlink.done': {
    hi: 'अलग कर दिया। इस चैट में अब चेतावनियाँ नहीं आएँगी। मौसम आप अब भी पूछ सकते हैं।',
    en: 'Disconnected. This chat no longer receives alerts. You can still ask about the weather.',
  },
  'tg.unlink.fromWeb': {
    hi: 'chaatak.com पर इस टेलीग्राम को आपके चातक खाते से अलग कर दिया गया। अब यहाँ चेतावनियाँ नहीं आएँगी।',
    en: 'This Telegram was disconnected from your Chaatak account on chaatak.com. Warnings will no longer arrive here.',
  },
  'tg.back': { hi: '‹ वापस', en: '‹ Back' },

  'tg.places.title': { hi: 'आपकी जगहें', en: 'Your places' },
  'tg.places.empty': {
    hi: 'अभी कोई जगह सहेजी नहीं है। किसी जगह का मौसम पूछें, फिर 🔔 दबाकर उसकी चेतावनी पाएँ।',
    en: 'No places saved yet. Ask about a place, then tap 🔔 to get its alerts.',
  },
  'tg.places.hint': { hi: 'मौसम देखने के लिए जगह दबाएँ।', en: 'Tap a place for its weather.' },
  'tg.places.guest': {
    hi: 'सहेजी जगहें चातक खाते में रहती हैं। अपना खाता जोड़ें — तीन जगहों तक पर नज़र रखें और उनकी IMD चेतावनियाँ यहीं पाएँ।',
    en: 'Saved places belong to a Chaatak account. Connect yours to watch up to three places and get their IMD warnings here.',
  },
  'tg.places.remove': { hi: 'हटाएँ', en: 'Remove' },
  'tg.places.removed': { hi: '{place} की निगरानी बंद।', en: 'Stopped watching {place}.' },

  'tg.alerts.on': { hi: 'इस चैट में {places} के लिए चालू।', en: 'On in this chat for {places}.' },
  'tg.alerts.onEmpty': {
    hi: 'इस चैट में चालू है, पर अभी कोई जगह सहेजी नहीं है। किसी जगह का मौसम पूछें, फिर 🔔 दबाकर उसकी चेतावनी पाएँ।',
    en: 'On in this chat, but no places are saved yet. Ask about a place, then tap 🔔 to get its alerts.',
  },
  'tg.alerts.paused': {
    hi: 'इस चैट में रुकी हुई हैं। आपकी सहेजी जगहें वैसी ही हैं।',
    en: 'Paused in this chat. Your saved places are unchanged.',
  },
  'tg.alerts.what': {
    hi: 'सिर्फ़ IMD की आधिकारिक ज़िला चेतावनियाँ — कभी किसी मॉडल का अनुमान नहीं। चेतावनी जारी होने या बदलने पर एक संदेश, और जल्दी हटने पर एक संदेश।',
    en: 'Only official IMD district warnings — never a model’s guess. One message when a warning is issued or changes, and one if it is lifted early.',
  },
  'tg.alerts.guest': {
    hi: 'अपना चातक खाता जोड़ें और तीन सहेजी जगहों तक की IMD चेतावनियाँ यहीं पाएँ — बिना पूछे।',
    en: 'Connect your Chaatak account to get IMD warnings here for up to three saved places — before you have to ask.',
  },
  'tg.alerts.pause': { hi: 'यहाँ चेतावनी रोकें', en: 'Pause alerts here' },
  'tg.alerts.resume': { hi: 'यहाँ चेतावनी फिर शुरू करें', en: 'Resume alerts here' },
  'tg.alerts.pausedToast': { hi: 'इस चैट में चेतावनियाँ रोक दी गईं।', en: 'Alerts paused in this chat.' },
  'tg.alerts.resumedToast': { hi: 'इस चैट में चेतावनियाँ चालू।', en: 'Alerts on in this chat.' },

  'tg.settings.account': { hi: 'खाता: {account}', en: 'Account: {account}' },
  'tg.settings.noAccount': { hi: 'किसी चातक खाते से नहीं जुड़ा।', en: 'Not connected to a Chaatak account.' },
  'tg.settings.language': { hi: 'जवाब की भाषा: {language}', en: 'Reply language: {language}' },
  'tg.settings.languageGuest': {
    hi: 'मैं उसी भाषा में जवाब देता हूँ जिसमें आप लिखते हैं। कोई भाषा चुनने के लिए खाता जोड़ें — फिर वह यहाँ और chaatak.com दोनों पर लागू होगी।',
    en: 'I reply in the language you write in. Connect your account to choose one; it then applies here and on chaatak.com.',
  },
  'tg.settings.languageShared': {
    hi: 'यह वही सेटिंग है जो chaatak.com पर है।',
    en: 'The same setting as on chaatak.com.',
  },
  'tg.settings.saved': { hi: 'सहेज लिया। यह chaatak.com पर भी लागू होगा।', en: 'Saved. It applies on chaatak.com too.' },

  'tg.alert.official': { hi: 'IMD की आधिकारिक चेतावनी', en: 'Official IMD warning' },
  'tg.alert.until': { hi: '{time} तक', en: 'until {time}' },

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

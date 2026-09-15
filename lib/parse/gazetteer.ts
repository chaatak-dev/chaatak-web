/**
 * A seed gazetteer of Indian places, in both scripts.
 *
 * SCOPE, deliberately: this is a small verifiable list of state names and
 * large cities, not a district register. Inventing 800 district spellings from
 * memory would put wrong place names into a system whose whole argument is
 * that it does not invent things. Partial and honest beats complete and
 * fabricated.
 *
 * SUPERSEDED IN PHASE 4. IMD's own district list — with the Obj_ids the
 * warning API is keyed on — is the authoritative source. When the IMD adapter
 * lands, replace the contents of this file with that list and delete the seed
 * below; do not merge the two, because a hand-written entry that disagrees
 * with IMD's spelling is exactly the kind of quiet wrongness this file exists
 * to avoid.
 *
 * What it is used for:
 *   - the verification gate's unknownPlace check, which can only catch a
 *     fabricated place it recognises. Partial coverage is a floor, not a
 *     proof, and the gate says so.
 *
 * What it is NOT used for:
 *   - extracting a place from a sentence. The pattern layer does that by
 *     position — whatever is left once the keywords are removed — so an
 *     unlisted village parses exactly as well as Mumbai does.
 */

const STATES = [
  'Andhra Pradesh', 'आंध्र प्रदेश',
  'Arunachal Pradesh', 'अरुणाचल प्रदेश',
  'Assam', 'असम',
  'Bihar', 'बिहार',
  'Chhattisgarh', 'छत्तीसगढ़',
  'Goa', 'गोवा',
  'Gujarat', 'गुजरात',
  'Haryana', 'हरियाणा',
  'Himachal Pradesh', 'हिमाचल प्रदेश',
  'Jharkhand', 'झारखंड',
  'Karnataka', 'कर्नाटक',
  'Kerala', 'केरल',
  'Madhya Pradesh', 'मध्य प्रदेश',
  'Maharashtra', 'महाराष्ट्र',
  'Manipur', 'मणिपुर',
  'Meghalaya', 'मेघालय',
  'Mizoram', 'मिज़ोरम',
  'Nagaland', 'नागालैंड',
  'Odisha', 'ओडिशा',
  'Punjab', 'पंजाब',
  'Rajasthan', 'राजस्थान',
  'Sikkim', 'सिक्किम',
  'Tamil Nadu', 'तमिलनाडु',
  'Telangana', 'तेलंगाना',
  'Tripura', 'त्रिपुरा',
  'Uttar Pradesh', 'उत्तर प्रदेश',
  'Uttarakhand', 'उत्तराखंड',
  'West Bengal', 'पश्चिम बंगाल',
  'Delhi', 'दिल्ली',
  'Jammu and Kashmir', 'जम्मू और कश्मीर',
  'Ladakh', 'लद्दाख',
  'Puducherry', 'पुडुचेरी',
  'Chandigarh', 'चंडीगढ़',
];

const CITIES = [
  'Mumbai', 'मुंबई',
  'Delhi', 'दिल्ली',
  'Kolkata', 'कोलकाता',
  'Chennai', 'चेन्नई',
  'Bengaluru', 'बेंगलुरु',
  'Hyderabad', 'हैदराबाद',
  'Pune', 'पुणे',
  'Ahmedabad', 'अहमदाबाद',
  'Surat', 'सूरत',
  'Jaipur', 'जयपुर',
  'Lucknow', 'लखनऊ',
  'Kanpur', 'कानपुर',
  'Nagpur', 'नागपुर',
  'Indore', 'इंदौर',
  'Bhopal', 'भोपाल',
  'Patna', 'पटना',
  'Vadodara', 'वडोदरा',
  'Ludhiana', 'लुधियाना',
  'Agra', 'आगरा',
  'Varanasi', 'वाराणसी',
  'Meerut', 'मेरठ',
  'Rajkot', 'राजकोट',
  'Jabalpur', 'जबलपुर',
  'Gwalior', 'ग्वालियर',
  'Jodhpur', 'जोधपुर',
  'Ranchi', 'रांची',
  'Raipur', 'रायपुर',
  'Kota', 'कोटा',
  'Guwahati', 'गुवाहाटी',
  'Nashik', 'नासिक',
  'Faridabad', 'फरीदाबाद',
  'Ghaziabad', 'गाज़ियाबाद',
  'Noida', 'नोएडा',
  'Amritsar', 'अमृतसर',
  'Prayagraj', 'प्रयागराज',
  'Srinagar', 'श्रीनगर',
  'Dehradun', 'देहरादून',
  'Barabanki', 'बाराबंकी',
];

/** Lower-cased for substring matching. Devanagari is unaffected by casing. */
export const GAZETTEER: Set<string> = new Set(
  [...STATES, ...CITIES].map((p) => p.toLowerCase()),
);

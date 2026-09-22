/**
 * Builds the Telegram bot's profile photo from the official app icon.
 *
 *   node scripts/build-telegram-avatar.mjs
 *
 * Not a new logo: it is public/brand/chaatak-app-icon.svg — the dark app
 * icon, cream bird on ink over a grey cloud — with two changes that Telegram
 * needs and the icon does not:
 *
 *   - the background is full-bleed. The icon's rounded corners would show as
 *     black wedges once Telegram crops a square to a circle.
 *   - the mark is drawn at 80% about its centre. At full size the tail and
 *     the beak sit on the edge of the circle Telegram crops to, and at the
 *     40px a chat list shows avatars at, a mark that touches its frame reads
 *     as cut off.
 *
 * Output is a 640×640 JPEG, the format setMyProfilePhoto accepts for a static
 * photo. Uses sharp, which Next.js already installs for image optimisation.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';

const SOURCE = 'public/brand/chaatak-app-icon.svg';
const OUTPUT = 'public/brand/chaatak-telegram-avatar.jpg';

let svg = readFileSync(SOURCE, 'utf8').replace(/<metadata>[\s\S]*?<\/metadata>/, '');

const rect = '<rect width="400" height="400" rx="88" fill="#17191A"/>';
if (!svg.includes(rect)) throw new Error(`${SOURCE} no longer has the expected background`);

const open = svg.indexOf('<g transform=', svg.indexOf(rect));
const close = svg.lastIndexOf('</svg>');
svg =
  svg.slice(0, svg.indexOf(rect)) +
  '<rect width="400" height="400" fill="#17191A"/>' +
  '<g transform="translate(200 200) scale(0.8) translate(-200 -200)">' +
  svg.slice(open, close) +
  '</g></svg>';

const jpeg = await sharp(Buffer.from(svg), { density: 300 })
  .resize(640, 640)
  .flatten({ background: '#17191A' })
  .jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
  .toBuffer();

writeFileSync(OUTPUT, jpeg);
console.log(`wrote ${OUTPUT} (${jpeg.length} bytes)`);

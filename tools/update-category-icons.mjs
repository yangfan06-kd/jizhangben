// Run manually when updating the bundled category SVGs. Runtime never needs a network connection.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const version = 'v3.49.0';
const icons = {
  dining: 'bowl-spoon', transport: 'bus', shopping: 'shopping-bag', entertainment: 'confetti',
  home: 'home', health: 'first-aid-kit', education: 'school', sport: 'run', travel: 'luggage',
  pet: 'paw', digital: 'device-mobile', gift: 'gift', love: 'heart', insurance: 'shield-heart',
  dorm: 'building-community', groceries: 'basket', breakfast: 'egg-fried', meal: 'tools-kitchen-2',
  dinner: 'soup', fruit: 'apple', snack: 'cookie', drink: 'glass', game: 'device-gamepad-2',
  movie: 'movie', party: 'confetti', book: 'book', course: 'chalkboard', exam: 'clipboard-check',
  training: 'certificate', bus: 'bus', subway: 'train', taxi: 'car', rail: 'train', plane: 'plane',
  phone: 'device-mobile', clothes: 'shirt', shoes: 'shoe', beauty: 'brush', accessory: 'diamond',
  haircut: 'scissors', date: 'calendar-heart', anniversary: 'hearts', redpacket: 'mail',
  medicine: 'pill', checkup: 'stethoscope', rent: 'home-dollar', utilities: 'bolt', shared: 'users',
  property: 'building', daily: 'bottle', misc: 'box', other: 'dots',
  coffee: 'coffee', tea: 'teapot', bakery: 'bread', vegetables: 'carrot', seafood: 'fish',
  dessert: 'cake', delivery: 'bike', bicycle: 'bike', fuel: 'gas-station', parking: 'parking',
  repair: 'tool', hotel: 'building-skyscraper', internet: 'wifi', computer: 'device-laptop',
  subscription: 'repeat', music: 'music', photography: 'camera', childcare: 'baby-carriage',
  family: 'users-group', elderly: 'heart-handshake', salary: 'wallet', bonus: 'award',
  parttime: 'briefcase', pension: 'pig-money', bank: 'building-bank', interest: 'percentage',
  investment: 'chart-line', refund: 'receipt-refund', fee: 'receipt-tax', tax: 'file-invoice',
  savings: 'pig-money', office: 'briefcase', charity: 'heart-handshake', camping: 'tent',
  swimming: 'swimming', gym: 'barbell'
};

const allowedTags = new Set(['svg', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse']);
async function fetchIcon(name) {
  const url = `https://raw.githubusercontent.com/tabler/tabler-icons/${version}/icons/outline/${name}.svg`;
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  const source = await response.text();
  const match = source.match(/<svg\b[^>]*>([\s\S]*?)<\/svg>/i);
  if (!match) throw new Error(`${name}: missing SVG`);
  const body = match[1].replace(/<!--[^]*?-->/g, '').trim();
  for (const tag of body.matchAll(/<\/?([a-z][\w:-]*)\b[^>]*>/gi)) {
    if (!allowedTags.has(tag[1])) throw new Error(`${name}: unexpected element ${tag[1]}`);
    if (/\bon\w+\s*=|\bhref\s*=|javascript:/i.test(tag[0])) throw new Error(`${name}: unsafe attribute`);
  }
  return `<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">${body.replace(/\s+/g, ' ')}</svg>`;
}

const uniqueNames = [...new Set(Object.values(icons))];
const results = new Map();
const errors = [];
for (let index = 0; index < uniqueNames.length; index += 8) {
  const batch = uniqueNames.slice(index, index + 8);
  const fetched = await Promise.allSettled(batch.map(name => fetchIcon(name)));
  fetched.forEach((result, offset) => {
    if (result.status === 'fulfilled') results.set(batch[offset], result.value);
    else errors.push(String(result.reason));
  });
}
if (errors.length) throw new Error(errors.join('\n'));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const license = await fs.readFile(path.join(root, 'docs', 'TABLER_ICONS_LICENSE.txt'), 'utf8');
const output = [
  `// Selected Tabler Icons ${version}; MIT license. Source: https://github.com/tabler/tabler-icons`,
  '// Local-only assets: existing category keys remain stable across app upgrades and backups.',
  `/*\n${license.trim()}\n*/`,
  'const TABLER_CATEGORY_ICON_MARKUP = {',
  ...Object.entries(icons).map(([key, name]) => `  ${JSON.stringify(key)}: ${JSON.stringify(results.get(name))},`),
  '};', ''
].join('\n');
await fs.writeFile(path.join(root, 'js', 'category-icons-tabler.js'), output, 'utf8');
console.log(`Bundled ${Object.keys(icons).length} category keys using ${uniqueNames.length} SVG files.`);

import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
const sections = [
  '# Third party notices\n\nGenerated from package-lock.json by `node scripts/generate-notices.mjs`.\n' +
  'Includes all npm runtime dependencies, including packages used only by CLI paths.\n' +
  'Development/build tools and container base images retain their own upstream licenses.\n',
];
for (const [directory, pkg] of Object.entries(lock.packages)) {
  if (!directory.startsWith('node_modules/') || pkg.dev || pkg.link) continue;
  const name = directory.slice('node_modules/'.length);
  const files = (await readdir(directory)).filter((file) => /^(licen[cs]e|copying|notice)([.\-]|$)/i.test(file));
  if (!files.length) throw new Error(`Missing license text for ${name}`);
  sections.push(`## ${name} ${pkg.version}\n\nLicense: ${pkg.license || 'See text below'}.\n`);
  for (const file of files.sort()) {
    const contents = (await readFile(path.join(directory, file), 'utf8')).replaceAll('\r\n', '\n');
    sections.push(`### ${file}\n\n\`\`\`text\n${contents.trim()}\n\`\`\`\n`);
  }
}
const text = sections.join('\n');
await writeFile('THIRD_PARTY_NOTICES.md', text);
await writeFile('web/public/third-party-notices.txt', text);
await writeFile('web/public/license.txt', await readFile('LICENSE', 'utf8'));
console.log('Generated repository and distributed runtime license notices.');

import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {decodeZip, validateWavegame} from '../tools/wavegame/src/index.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const ids=['connect-four','checkers','chess','go','color-match'].map(id=>'games.wavegames.'+id);
// Immutable published downloads retained for existing installations and links.
const preserved={
  "RELEASE.json": "05cfe906ac06cd966ec02b6882ac2ef25493d7f52d9cbc3fb85227af1306f1df",
  "SHA256SUMS-ALL.txt": "8b0c9f5c5f422295e41842490d29423b51ee4aaf5460adfa64056989e2d082cd",
  "SHA256SUMS.txt": "1480e8deefef14ab83150ce6fd7b75dbab9e6d93c415926c47430b5ee7b8ac31",
  "TESTING.md": "030f250c8347e4d33cb062f8672e741c2f60972e3cac98c19bc0e338229b905e",
  "WaveGames-Cartridge-Example-Sources-1.0.0.zip": "c608ff4450264afeeb9266f2a9aaa50f4b63843769fe13043bbccd4065fc8ac9",
  "WaveGames-Cartridge-Examples-1.0.0.zip": "9e82001ca7da78d9d806ae262a451618f537cc058a5a6faa7e06b3684db25cc3",
  "WaveGames-Checkers-1.0.0.wavegame": "aef3a19f50f253adc7cdc68a38f85ee95a5b29021cfb4f115821ce5574a01a54",
  "WaveGames-Chess-1.0.0.wavegame": "c154a75e1684d4557c5f76afaa352756e9528bfb40143503e1d8c7648072b538",
  "WaveGames-Color-Match-1.0.0.wavegame": "f44b29d57699e6b0818032c67441d2cc2b71648ca1bd5cf54eda4d6ed1eb5eb6",
  "WaveGames-Connect-Four-1.0.0.wavegame": "ac472f26ac6b6b833613cba23b0115b4aef8d22cf309afe61bfe70d7dcf1e4cc",
  "WaveGames-Go-1.0.0.wavegame": "d713373a4ab88c884f80ca35364d43872bd24304bfd3b1fec0103a06825792ea"
};
const retiredBrand=/\b\x55\x4e\x4f\b/i;
for (const version of ['1.0.0','1.1.0']) {
 const release=root+'releases/'+version+'/';
 const manifest=JSON.parse(await readFile(release+'RELEASE.json','utf8'));
 assert.equal(manifest.bundleVersion,version);
 assert.deepEqual(manifest.games.map(game=>game.id),ids);
 for(const game of manifest.games){
  const bytes=await readFile(release+game.file),summary=validateWavegame(bytes);
  assert.equal(summary.id,game.id);
  assert.equal(summary.version,version);
  assert.equal(summary.packageDigest,game.packageDigest);
  assert.equal(bytes.length,game.bytes);
  assert.equal(hash(bytes),game.sha256);
 }
 const names=(await readdir(release)).sort();
 assert.deepEqual(names.filter(name=>name.endsWith('.wavegame')),manifest.games.map(game=>game.file).sort());
 if(version==='1.0.0') assert.deepEqual(names,Object.keys(preserved).sort());
 for(const name of names){
  const bytes=await readFile(release+name);
  if(version==='1.0.0')assert.equal(hash(bytes),preserved[name],`Changed retained download: ${name}`);
  scan(bytes,version+'/'+name);
 }
}
function hash(bytes){return createHash('sha256').update(bytes).digest('hex');}
function scan(bytes,label){
 assert.equal(retiredBrand.test(label),false,`Retired branding in path: ${label}`);
 if(bytes[0]===0x50&&bytes[1]===0x4b){
  for(const [name,data] of decodeZip(bytes).entries)scan(data,label+'!'+name);
 }else assert.equal(retiredBrand.test(bytes.toString('utf8')),false,`Retired branding in content: ${label}`);
}
console.log('PASS: both releases validated, all eleven previous downloads unchanged, exact game inventories and recursive bundle branding checks');

import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {decodeZip, validateWavegame} from '../tools/wavegame/src/index.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const release=root+'releases/1.0.0/';
const manifest=JSON.parse(await readFile(release+'RELEASE.json','utf8'));
const ids=['connect-four','checkers','chess','go','color-match'].map(id=>'games.wavegames.'+id);
assert.deepEqual(manifest.games.map(game=>game.id),ids);
const preserved={
 'WaveGames-Connect-Four-1.0.0.wavegame':'ac472f26ac6b6b833613cba23b0115b4aef8d22cf309afe61bfe70d7dcf1e4cc',
 'WaveGames-Checkers-1.0.0.wavegame':'aef3a19f50f253adc7cdc68a38f85ee95a5b29021cfb4f115821ce5574a01a54',
 'WaveGames-Chess-1.0.0.wavegame':'c154a75e1684d4557c5f76afaa352756e9528bfb40143503e1d8c7648072b538',
 'WaveGames-Go-1.0.0.wavegame':'d713373a4ab88c884f80ca35364d43872bd24304bfd3b1fec0103a06825792ea',
};
const retiredBrand=/\b\x55\x4e\x4f\b/i;
for(const game of manifest.games){
 const bytes=await readFile(release+game.file),summary=validateWavegame(bytes);
 assert.equal(summary.id,game.id);
 assert.equal(summary.packageDigest,game.packageDigest);
 assert.equal(bytes.length,game.bytes);
 const hash=createHash('sha256').update(bytes).digest('hex');
 assert.equal(hash,game.sha256);
 if(preserved[game.file])assert.equal(hash,preserved[game.file]);
}
const actual=(await readdir(release)).filter(name=>name.endsWith('.wavegame')).sort();
assert.deepEqual(actual,manifest.games.map(game=>game.file).sort());
for(const name of await readdir(release))scan(await readFile(release+name),name);
function scan(bytes,label){
 assert.equal(retiredBrand.test(label),false,`Retired branding in path: ${label}`);
 if(bytes[0]===0x50&&bytes[1]===0x4b){
  for(const [name,data] of decodeZip(bytes).entries)scan(data,label+'!'+name);
 }else assert.equal(retiredBrand.test(bytes.toString('utf8')),false,`Retired branding in content: ${label}`);
}
console.log('PASS: five validated packages, four unchanged game hashes, current inventory, and recursive bundle branding checks');

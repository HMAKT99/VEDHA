import fs from 'fs'; import path from 'path';
const ev = JSON.parse(fs.readFileSync('pwcore-src-analysis.json','utf8')).normalized_result.graph;
const m = {};
for (const e of ev.edges) { if (e.relation!=='imports') continue;
  const src = e.evidence.location.value.source; const spec = e.properties.specifier; if(!spec) continue;
  const sd = src.split('/')[0]==='server'||src.split('/').length>1 ? src.split('/')[0] : '(root)';
  let td;
  if (spec.startsWith('.')) { const r = path.posix.normalize(path.posix.join(path.posix.dirname(src), spec)); td = r.split('/')[0].replace(/\.ts$/,''); if (!r.includes('/')) td='(root)'; }
  else if (spec.startsWith('@')) td = spec.split('/')[0]; else td = 'npm/node';
  if (td===sd) continue; const k=`${sd} -> ${td}`; m[k]=(m[k]||0)+1; }
fs.writeFileSync('derived/dir-import-matrix.json', JSON.stringify(Object.fromEntries(Object.entries(m).sort((a,b)=>b[1]-a[1])),null,1));
console.log(Object.entries(m).sort((a,b)=>b[1]-a[1]).slice(0,30).map(([k,v])=>v+' '+k).join('\n'));

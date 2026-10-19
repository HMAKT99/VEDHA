import { chromium } from 'playwright';
const b = await chromium.launch(); const p = await (await b.newContext()).newPage();
await p.setContent('<button>A</button><button>B</button><p id=x>hi</p>');
const s1 = await p.ariaSnapshot({mode:'ai'});
await p.evaluate(()=>{document.body.insertAdjacentHTML('afterbegin','<button>New</button>')});
const s2 = await p.ariaSnapshot({mode:'ai'});
let clickByOldRef;
try { await p.locator('aria-ref=e3').click({timeout:800}); clickByOldRef='clicked'; } catch(e){ clickByOldRef=e.message.split('\n')[0]; }
const s3 = await p.ariaSnapshot({mode:'ai'});
console.log(JSON.stringify({s1,s2,s3,clickByOldRef},null,1));
await b.close();

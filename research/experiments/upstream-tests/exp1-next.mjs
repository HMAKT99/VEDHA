import pkg from '<scratch>/pw-build/packages/playwright-core/index.js'; const { chromium } = pkg;
const html = `<button id=b onclick="setTimeout(()=>{document.body.insertAdjacentHTML('beforeend','<p id=done>Saved</p>')},300)">Save</button>
<div style="position:fixed;inset:0;background:rgba(0,0,0,.1)" id=ov></div>`;
const out = { steps: [] };
const t0 = Date.now();
const browser = await chromium.launch(); out.launchMs = Date.now()-t0;
const ctx = await browser.newContext(); const page = await ctx.newPage();
await page.setContent(html);
// Scenario 3: click blocked by overlay -> timeout w/ call log (scenario 5)
try { await page.getByRole('button',{name:'Save'}).click({timeout:1500}); }
catch (e) { out.clickTimeout = e.message; }
await page.evaluate(()=>document.getElementById('ov').remove());
await page.getByRole('button',{name:'Save'}).click({timeout:3000});
// Scenario 4: dynamic wait via web-first assertion
await page.locator('#done').waitFor({timeout:3000}); out.waitedForDone = await page.locator('#done').innerText();
try { await page.locator('#nope').click({timeout:600}); } catch(e){ out.missingTimeout = e.message; }
out.aria = await page.ariaSnapshot({mode:'ai'});
await browser.close();
console.log(JSON.stringify(out,null,2));

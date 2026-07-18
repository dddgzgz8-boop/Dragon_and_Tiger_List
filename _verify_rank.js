const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('file://' + path.resolve(__dirname, 'D老师.html'));
  await page.waitForTimeout(500);

  const tabs = ['profit', 'success', 'point'];
  for (const tab of tabs) {
    await page.click(`.tab-item[data-tab="${tab}"]`);
    await page.waitForTimeout(200);
    const rows = await page.$$eval(`#panel-${tab} tbody tr`, trs =>
      trs.map(tr => Array.from(tr.querySelectorAll('td')).map(td => td.textContent.trim()))
    );
    console.log(`--- ${tab} ---`);
    rows.forEach(r => console.log(r.join(' | ')));
  }

  await page.screenshot({ path: 'e:\\Dragon_and_Tiger_List\\_verify_total.png', fullPage: true });
  await browser.close();
})();

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const inDir = path.join(__dirname, '../../render_out');
const outDir = path.join(__dirname, '../../render_out_png');

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

async function run() {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  
  // Set viewport to 64x64 - appropriate for recipe item slots
  await page.setViewport({ width: 64, height: 64, deviceScaleFactor: 2 }); // 2x for retina-quality

  const files = fs.readdirSync(inDir).filter(f => f.endsWith('.svg'));
  
  console.log(`Found ${files.length} SVGs to convert.`);
  
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const name = file.replace('.svg', '');
    const svgPath = path.join(inDir, file);
    const pngPath = path.join(outDir, `${name}.png`);
    
    const svgContent = fs.readFileSync(svgPath, 'utf-8');
    
    // Skip 2D items - the worker already handles these with the flat texture
    if (svgContent.includes('viewBox="0 0 16 16"')) {
        continue;
    }

    try {
        // The SVG already has a properly auto-sized viewBox, no modification needed
        const html = `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:transparent;display:flex;align-items:center;justify-content:center;width:64px;height:64px;">
  <div style="width:64px;height:64px;display:flex;align-items:center;justify-content:center;">
    ${svgContent.replace(/width="[^"]*"/, 'width="64"').replace(/height="[^"]*"/, 'height="64"')}
  </div>
</body>
</html>`;
        
        await page.setContent(html, { waitUntil: 'load' });
        
        const svgElement = await page.$('svg');
        if (svgElement) {
           await svgElement.screenshot({ path: pngPath, omitBackground: true });
           if (i % 100 === 0) console.log(`Converted ${i}/${files.length} (${name}.png)`);
        }
    } catch (e) {
        console.error(`Failed to convert ${file}:`, e.message);
    }
  }
  
  await browser.close();
  console.log('Conversion complete!');
}

run().catch(console.error);

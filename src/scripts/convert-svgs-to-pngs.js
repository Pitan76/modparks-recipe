const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const inDir = path.join(__dirname, '../../render_out');
const outDir = path.join(__dirname, '../../render_out_png');

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

async function run() {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  // Set viewport to the desired image size
  await page.setViewport({ width: 256, height: 256, deviceScaleFactor: 1 });

  const files = fs.readdirSync(inDir).filter(f => f.endsWith('.svg'));
  
  console.log(`Found ${files.length} SVGs to convert.`);
  
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const name = file.replace('.svg', '');
    const svgPath = path.join(inDir, file);
    const pngPath = path.join(outDir, `${name}.png`);
    
    // Skip if SVG is just a 2D wrapper
    const svgContent = fs.readFileSync(svgPath, 'utf-8');
    if (svgContent.includes('<svg viewBox="0 0 16 16"')) {
        continue; // 2D item, we'll let minecraft.ts handle it using the original item/xxx.png
    }

    try {
        // Fix the viewBox to make it fit nicely!
        // We know from earlier that viewBox="-13 -13.5 26 27" is perfect
        let modifiedSvg = svgContent.replace('viewBox="-24 -24 48 48"', 'viewBox="-13 -13.5 26 27"');
        
        // Load it into puppeteer
        const html = `
        <!DOCTYPE html>
        <html>
        <body style="margin:0;padding:0;background:transparent;">
          ${modifiedSvg}
        </body>
        </html>
        `;
        
        await page.setContent(html, { waitUntil: 'load' });
        
        // Take a screenshot of the svg element itself for perfect transparency
        const svgElement = await page.$('svg');
        if (svgElement) {
           await svgElement.screenshot({ path: pngPath, omitBackground: true });
           if (i % 50 === 0) console.log(`Converted ${i}/${files.length} (${name}.png)`);
        }
    } catch (e) {
        console.error(`Failed to convert ${file}:`, e);
    }
  }
  
  await browser.close();
  console.log('Conversion complete!');
}

run().catch(console.error);

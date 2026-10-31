// Rasterises SVG strings in Chromium, one page for the whole run: each document becomes an <img> drawn to a canvas at its
// supersampled size and is scaled down in the page, so one code path serves frames, the hero and the background.
import { chromium } from 'playwright';

export class Renderer {
  async open() {
    this.browser = await chromium.launch();
    this.page = await this.browser.newPage({ viewport: { width: 800, height: 600 } });
    await this.page.setContent('<!doctype html><html><body></body></html>');
    await this.page.evaluate(() => {
      window.__load = async (svg) => {
        const img = new Image();
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
        await img.decode();
        return img;
      };
      /** Scale down by halves, then to the exact size: cleaner than a single pass. */
      window.__down = (src, w, h) => {
        let cur = src;
        let cw = src.width,
          ch = src.height;
        while (cw >= w * 2 && ch >= h * 2) {
          const c = document.createElement('canvas');
          c.width = cw >> 1;
          c.height = ch >> 1;
          const g = c.getContext('2d');
          g.imageSmoothingEnabled = true;
          g.imageSmoothingQuality = 'high';
          g.drawImage(cur, 0, 0, c.width, c.height);
          cur = c;
          cw = c.width;
          ch = c.height;
        }
        if (cw === w && ch === h) return cur;
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const g = c.getContext('2d');
        g.imageSmoothingEnabled = true;
        g.imageSmoothingQuality = 'high';
        g.drawImage(cur, 0, 0, w, h);
        return c;
      };
      /** A light unsharp mask on the colour, to restore the snap the scale-down takes off thin lines. */
      window.__sharpen = (canvas, amount) => {
        const w = canvas.width,
          h = canvas.height;
        const g = canvas.getContext('2d', { willReadFrequently: true });
        const im = g.getImageData(0, 0, w, h);
        const d = im.data;
        const blur = document.createElement('canvas');
        blur.width = w;
        blur.height = h;
        const b = blur.getContext('2d', { willReadFrequently: true });
        b.filter = 'blur(0.8px)';
        b.drawImage(canvas, 0, 0);
        const e = b.getImageData(0, 0, w, h).data;
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 3] < 8) continue;
          for (let k = 0; k < 3; k++) d[i + k] = Math.max(0, Math.min(255, d[i + k] + (d[i + k] - e[i + k]) * amount));
        }
        g.putImageData(im, 0, 0);
      };
      window.__frames = new Map();
    });
  }
  /** Render `svg` (already sized at its supersampled size) and keep it in the page under `key` at w × h. */
  async frame(key, svg, w, h, { sharpen = 0.35 } = {}) {
    await this.page.evaluate(
      async ([key, svg, w, h, sharpen]) => {
        const img = await window.__load(svg);
        const big = document.createElement('canvas');
        big.width = img.naturalWidth;
        big.height = img.naturalHeight;
        big.getContext('2d').drawImage(img, 0, 0);
        const out = window.__down(big, w, h);
        if (sharpen) window.__sharpen(out, sharpen);
        window.__frames.set(key, out);
      },
      [key, svg, w, h, sharpen],
    );
  }
  /** Run a function in the page and return its value. */
  eval(fn, arg) {
    return this.page.evaluate(fn, arg);
  }
  /** A kept canvas as bytes in the given format. */
  async bytes(key, type = 'image/png', quality) {
    const b64 = await this.page.evaluate(([key, type, quality]) => window.__frames.get(key).toDataURL(type, quality).split(',')[1], [key, type, quality]);
    return Buffer.from(b64, 'base64');
  }
  close() {
    return this.browser.close();
  }
}

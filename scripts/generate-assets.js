import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

// Cores de fundo dos tiles (têm de bater certo com o que está "queimado" nas
// imagens, senão vê-se a costura entre o tile e o preenchimento que adicionamos).
// Amostradas dos cantos das imagens em public/.
const LIGHT_BG = '#FFFFFF';
const DARK_BG = '#18181B';

// Helper to convert an image to data URL
function getBase64DataUrl(filePath) {
  const ext = path.extname(filePath).slice(1);
  const data = fs.readFileSync(filePath).toString('base64');
  return `data:image/${ext};base64,${data}`;
}

function requireFile(filePath, label) {
  if (!fs.existsSync(filePath)) {
    console.error(`${label} not found at: ${filePath}`);
    process.exit(1);
  }
}

async function main() {
  // Tiles full-bleed (quadrados) usados como ícone da app, um por modo.
  const lightTilePath = path.join(repoRoot, 'public', 'manage-eat-logo-light.png');
  const darkTilePath = path.join(repoRoot, 'public', 'manage-eat-logo-dark.png');
  // Wordmark usado só no splash Android (mantido como estava).
  const wordmarkPath = path.join(repoRoot, 'public', 'manage-eat.png');
  // Wordmarks por tema para o splash do iOS (texto escuro p/ fundo claro e
  // vice-versa) — o Contents.json do Splash.imageset troca-os pelo modo do SO.
  const lightWordmarkPath = path.join(repoRoot, 'public', 'manage-eat-light.png');
  const darkWordmarkPath = path.join(repoRoot, 'public', 'manage-eat-dark.png');

  requireFile(lightTilePath, 'Light tile');
  requireFile(darkTilePath, 'Dark tile');
  requireFile(wordmarkPath, 'Source wordmark');
  requireFile(lightWordmarkPath, 'Light wordmark');
  requireFile(darkWordmarkPath, 'Dark wordmark');

  const lightTile = getBase64DataUrl(lightTilePath);
  const darkTile = getBase64DataUrl(darkTilePath);
  const wordmarkBase64 = getBase64DataUrl(wordmarkPath);
  const lightWordmark = getBase64DataUrl(lightWordmarkPath);
  const darkWordmark = getBase64DataUrl(darkWordmarkPath);

  console.log('Launching browser to render icons...');
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const iosIconDir = 'ios/App/App/Assets.xcassets/AppIcon.appiconset';

  // Tasks configuration
  const tasks = [
    // ── iOS App Icon: 3 variantes de aparência (claro/escuro/tinted, iOS 18+) ──
    // Full-bleed e opacos. O iOS troca-os sozinho conforme o modo do sistema;
    // em iOS <18 usa sempre o "light" (a entrada "any" do Contents.json).
    {
      source: lightTile,
      dest: path.join(repoRoot, `${iosIconDir}/AppIcon-light.png`),
      width: 1024,
      height: 1024,
      options: { background: LIGHT_BG, fit: 'cover', scalePercent: 1 }
    },
    {
      source: darkTile,
      dest: path.join(repoRoot, `${iosIconDir}/AppIcon-dark.png`),
      width: 1024,
      height: 1024,
      options: { background: DARK_BG, fit: 'cover', scalePercent: 1 }
    },
    {
      // Tinted: grayscale a partir do tile escuro. O texto branco vira cinza
      // claro (recebe o tint do sistema) e o fundo escuro mantém-se.
      source: darkTile,
      dest: path.join(repoRoot, `${iosIconDir}/AppIcon-tinted.png`),
      width: 1024,
      height: 1024,
      options: { background: DARK_BG, fit: 'cover', scalePercent: 1, grayscale: true }
    },
    // ── Android: um único ícone (tile escuro). O Android não troca por modo. ──
    // Foreground adaptive: o wordmark é reduzido para caber na safe zone da
    // máscara (círculo/squircle recortam ~33%) e o resto é preenchido com a
    // mesma cor de fundo, por isso a costura fica invisível.
    ...['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'].map((density, idx) => {
      const sizes = [108, 162, 216, 324, 432];
      return {
        source: darkTile,
        dest: path.join(repoRoot, `android/app/src/main/res/mipmap-${density}/ic_launcher_foreground.png`),
        width: sizes[idx],
        height: sizes[idx],
        options: { background: DARK_BG, scalePercent: 0.78, fit: 'contain' }
      };
    }),
    // Android legacy (pré-API 26): ícone quadrado, fundo escuro.
    ...['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'].map((density, idx) => {
      const sizes = [48, 72, 96, 144, 192];
      return {
        source: darkTile,
        dest: path.join(repoRoot, `android/app/src/main/res/mipmap-${density}/ic_launcher.png`),
        width: sizes[idx],
        height: sizes[idx],
        options: { background: DARK_BG, scalePercent: 0.85, fit: 'contain' }
      };
    }),
    // Android legacy round: círculo de fundo escuro.
    ...['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'].map((density, idx) => {
      const sizes = [48, 72, 96, 144, 192];
      return {
        source: darkTile,
        dest: path.join(repoRoot, `android/app/src/main/res/mipmap-${density}/ic_launcher_round.png`),
        width: sizes[idx],
        height: sizes[idx],
        options: { background: 'circle', circleColor: DARK_BG, scalePercent: 0.72, fit: 'contain' }
      };
    }),
    // ── Android System-Splash Screen Icon (inalterado) ──
    {
      source: wordmarkBase64,
      dest: path.join(repoRoot, 'android/app/src/main/res/drawable/splash_icon.png'),
      width: 1152,
      height: 1152,
      options: { background: 'transparent', scalePercent: 0.55, fit: 'contain' }
    },
    // ── iOS Splash: variante clara (default) e escura ──
    // As cores de fundo batem certo com os temas da app (index.css) e com o
    // splash Android (styles.xml/values-night) — arranque sem "flash" de cor.
    {
      source: lightWordmark,
      dest: path.join(repoRoot, 'ios/App/App/Assets.xcassets/Splash.imageset/Splash-light.png'),
      width: 2732,
      height: 2732,
      options: { background: '#F6F7F8', scalePercent: 0.4, fit: 'contain' }
    },
    {
      source: darkWordmark,
      dest: path.join(repoRoot, 'ios/App/App/Assets.xcassets/Splash.imageset/Splash-dark.png'),
      width: 2732,
      height: 2732,
      options: { background: '#09090B', scalePercent: 0.4, fit: 'contain' }
    }
  ];

  for (const task of tasks) {
    console.log(`Generating: ${path.relative(repoRoot, task.dest)} (${task.width}x${task.height})...`);

    const resultDataUrl = await page.evaluate(async ({ source, width, height, options }) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');

      // Setup Background
      if (options.background === 'transparent') {
        ctx.clearRect(0, 0, width, height);
      } else if (options.background === 'circle') {
        ctx.fillStyle = options.circleColor || '#FFFFFF';
        ctx.beginPath();
        ctx.arc(width / 2, height / 2, width / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // 'white' por compatibilidade; qualquer outra string é uma cor hex.
        ctx.fillStyle = options.background === 'white' ? '#FFFFFF' : options.background;
        ctx.fillRect(0, 0, width, height);
      }

      // Load Image
      const img = new Image();
      img.src = source;
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });

      // Calculate scaled dimensions
      const scalePercent = options.scalePercent ?? 1;
      let dw, dh;
      if (options.fit === 'cover') {
        // Enche todo o canvas (full-bleed). Para fonte quadrada em canvas
        // quadrado, cobre exatamente.
        const scale = Math.max(width / img.width, height / img.height) * scalePercent;
        dw = img.width * scale;
        dh = img.height * scale;
      } else {
        // 'contain': cabe dentro de (width*scalePercent) x (height*scalePercent).
        const scale = Math.min((width * scalePercent) / img.width, (height * scalePercent) / img.height);
        dw = img.width * scale;
        dh = img.height * scale;
      }

      const dx = (width - dw) / 2;
      const dy = (height - dh) / 2;

      // Grayscale só na imagem (não no fundo), p/ o ícone "tinted" do iOS.
      if (options.grayscale) {
        ctx.filter = 'grayscale(1)';
      }
      ctx.drawImage(img, dx, dy, dw, dh);
      ctx.filter = 'none';

      return canvas.toDataURL('image/png');
    }, { source: task.source, width: task.width, height: task.height, options: task.options });

    // Save output
    const base64Data = resultDataUrl.replace(/^data:image\/png;base64,/, '');
    fs.mkdirSync(path.dirname(task.dest), { recursive: true });
    fs.writeFileSync(task.dest, base64Data, 'base64');
  }

  await browser.close();

  // Limpeza: ficheiros que os Contents.json deixaram de referenciar.
  const staleFiles = [
    path.join(repoRoot, `${iosIconDir}/AppIcon-512@2x.png`),
    // Splash antigo (imagem única escura ×3 escalas) — substituído pelo par
    // claro/escuro acima.
    path.join(repoRoot, 'ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732.png'),
    path.join(repoRoot, 'ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732-1.png'),
    path.join(repoRoot, 'ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732-2.png'),
  ];
  for (const stale of staleFiles) {
    if (fs.existsSync(stale)) {
      fs.rmSync(stale);
      console.log(`Removed stale: ${path.relative(repoRoot, stale)}`);
    }
  }

  console.log('Successfully generated all assets!');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

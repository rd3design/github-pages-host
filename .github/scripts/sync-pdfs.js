// .github/scripts/sync-pdfs.js
// Reads projects.json, fetches each PDF from Dropbox, uploads to Cloudflare R2,
// and writes back updated projects.json with R2 public URLs.

const fs   = require('fs');
const path = require('path');
const https = require('https');
const { S3Client, PutObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');

// ── Config from environment ───────────────────────────────────────────────────
const R2_ACCOUNT_ID    = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_KEY    = process.env.R2_SECRET_KEY;
const R2_BUCKET        = process.env.R2_BUCKET;
const R2_PUBLIC_URL    = (process.env.R2_PUBLIC_URL || '').replace(/\/$/, ''); // no trailing slash
const DRY_RUN          = process.env.DRY_RUN === 'true';
const LIMIT            = parseInt(process.env.LIMIT || '0', 10);

if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_KEY || !R2_BUCKET || !R2_PUBLIC_URL) {
  console.error('❌ Missing required env vars. Need: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_KEY, R2_BUCKET, R2_PUBLIC_URL');
  process.exit(1);
}

// ── R2 client (S3-compatible) ─────────────────────────────────────────────────
const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId:     R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_KEY,
  },
});

// ── Helpers ───────────────────────────────────────────────────────────────────

// Convert a Dropbox share URL to a direct download URL
function toDirectUrl(dropboxUrl) {
  if (!dropboxUrl) return null;
  return dropboxUrl
    .replace('www.dropbox.com', 'dl.dropboxusercontent.com')
    .replace('?dl=0', '?raw=1')
    .replace('&dl=0', '&raw=1')
    .replace('?dl=1', '?raw=1')
    .replace('&dl=1', '&raw=1');
}

// Fetch a URL and return a Buffer
function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    const get = (u, redirects = 0) => {
      if (redirects > 5) return reject(new Error('Too many redirects'));
      https.get(u, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return get(res.headers.location, redirects + 1);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} for ${u}`));
        }
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      }).on('error', reject);
    };
    get(url);
  });
}

// Check if a key already exists in R2
async function existsInR2(key) {
  try {
    await r2.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

// Upload a buffer to R2
async function uploadToR2(key, buffer) {
  await r2.send(new PutObjectCommand({
    Bucket:      R2_BUCKET,
    Key:         key,
    Body:        buffer,
    ContentType: 'application/pdf',
    CacheControl: 'public, max-age=31536000', // 1 year — PDFs don't change often
  }));
  return `${R2_PUBLIC_URL}/${key}`;
}

// Sanitize a unit number into a safe filename
function safeKey(unitNumber) {
  return `pdm/${unitNumber.replace(/[^a-zA-Z0-9._-]/g, '_')}.pdf`;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const projectsPath = path.join(process.cwd(), 'projects.json');
  if (!fs.existsSync(projectsPath)) {
    console.error('❌ projects.json not found at', projectsPath);
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(projectsPath, 'utf8'));
  // projects.json shape: { stats: {...}, projects: [...] }
  const projects = Array.isArray(raw) ? raw : (raw.projects || []);
  console.log(`📦 Loaded ${projects.length} projects from projects.json`);

  if (DRY_RUN) console.log('🔍 DRY RUN — no uploads will happen');

  // Collect all unique PDF links across all projects
  const tasks = [];
  for (const proj of projects) {
    for (const file of (proj.files || [])) {
      if (file.pdfUrl && !file.r2Url) {
        tasks.push({ proj, file });
      }
    }
  }

  console.log(`🔗 Found ${tasks.length} PDFs without R2 URLs`);

  const toProcess = LIMIT > 0 ? tasks.slice(0, LIMIT) : tasks;
  if (LIMIT > 0) console.log(`⚠️  Limiting to ${LIMIT} PDFs for this run`);

  let uploaded = 0, skipped = 0, failed = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const { proj, file } = toProcess[i];
    const key = safeKey(proj.unitNumber);
    const label = `[${i + 1}/${toProcess.length}] ${proj.unitNumber}`;

    try {
      // Check if already in R2
      if (!DRY_RUN && await existsInR2(key)) {
        const r2Url = `${R2_PUBLIC_URL}/${key}`;
        file.r2Url = r2Url;
        console.log(`  ⏭  ${label} — already in R2, updating URL`);
        skipped++;
        continue;
      }

      const directUrl = toDirectUrl(file.pdfUrl);
      if (!directUrl) {
        console.warn(`  ⚠️  ${label} — no valid Dropbox URL, skipping`);
        failed++;
        continue;
      }

      console.log(`  ⬇️  ${label} — fetching from Dropbox…`);
      const buffer = await fetchBuffer(directUrl);
      console.log(`  ✅ ${label} — fetched ${(buffer.length / 1024).toFixed(0)} KB`);

      if (!DRY_RUN) {
        const r2Url = await uploadToR2(key, buffer);
        file.r2Url = r2Url;
        console.log(`  ☁️  ${label} — uploaded → ${r2Url}`);
        uploaded++;
      } else {
        console.log(`  🔍 ${label} — DRY RUN, would upload as ${key}`);
        skipped++;
      }

    } catch (err) {
      console.error(`  ❌ ${label} — ${err.message}`);
      failed++;
    }

    // Small delay to avoid hammering Dropbox
    if (i < toProcess.length - 1) await new Promise(r => setTimeout(r, 300));
  }

  console.log(`\n📊 Done: ${uploaded} uploaded, ${skipped} skipped, ${failed} failed`);

  if (!DRY_RUN && uploaded > 0) {
    // Write back preserving the original wrapper shape
    const output = Array.isArray(raw) ? projects : { ...raw, projects };
    fs.writeFileSync(projectsPath, JSON.stringify(output, null, 2));
    console.log('💾 projects.json updated with R2 URLs');
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

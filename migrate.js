/**
 * One-time migration script: imports data from JSON files into SQLite.
 * Run with: node migrate.js
 *
 * Safe to run multiple times — it skips records that already exist.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./src/db');

function loadJSON(filename) {
  const filepath = path.join(__dirname, filename);
  try {
    return JSON.parse(fs.readFileSync(filepath, 'utf8'));
  } catch {
    console.log(`  Skipping ${filename} (not found or empty)`);
    return null;
  }
}

console.log('=== HOLO Tools — JSON to SQLite migration ===\n');

// ── Clients ──
const clients = loadJSON('clients.json');
if (clients && clients.length) {
  let imported = 0, skipped = 0;
  for (const c of clients) {
    if (db.getClient(c.id)) { skipped++; continue; }
    db.createClient(c);
    imported++;
  }
  console.log(`Clients: ${imported} imported, ${skipped} already exist`);
} else {
  console.log('Clients: no data to import');
}

// ── Roadmap ──
const roadmap = loadJSON('roadmap.json');
if (roadmap && roadmap.length) {
  const existing = db.getAllRoadmapItems();
  if (existing.length === 0) {
    db.saveAllRoadmapItems(roadmap);
    console.log(`Roadmap: ${roadmap.length} items imported`);
  } else {
    console.log(`Roadmap: ${existing.length} items already in database, skipping`);
  }
} else {
  console.log('Roadmap: no data to import');
}

// ── GBP Posts ──
const gbpPosts = loadJSON('gbp-posts.json');
if (gbpPosts && gbpPosts.length) {
  let imported = 0, skipped = 0;
  for (const p of gbpPosts) {
    if (db.getGBPPost(p.id)) { skipped++; continue; }
    db.createGBPPost(p);
    imported++;
  }
  console.log(`GBP Posts: ${imported} imported, ${skipped} already exist`);
} else {
  console.log('GBP Posts: no data to import');
}

// ── Usage ──
const usage = loadJSON('usage.json');
if (usage && usage.calls && usage.calls.length) {
  // Check if we already have usage data
  const stats = db.getUsageStats();
  if (stats.total.calls === 0) {
    for (const call of usage.calls) {
      db.logUsage(call);
    }
    console.log(`Usage: ${usage.calls.length} log entries imported`);
  } else {
    console.log(`Usage: ${stats.total.calls} entries already in database, skipping`);
  }
} else {
  console.log('Usage: no data to import');
}

console.log('\nMigration complete. Database file: holo.db');
console.log('You can now start the server with: node server.js');

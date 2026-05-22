const mongoose = require('mongoose');
require('dotenv').config();
const Account = require('../models/account');

function normalizePhone(phone) {
  return String(phone || '').trim().replace(/\s+/g, '').replace(/^0+/, '');
}

async function main() {
  const mongoURI = process.env.MONGODB_URI;
  if (!mongoURI) {
    console.error('Missing MONGODB_URI environment variable');
    process.exit(1);
  }

  await mongoose.connect(mongoURI, { useNewUrlParser: true, useUnifiedTopology: true });

  const accounts = await Account.find().sort({ createdAt: 1 });
  const byPhone = new Map();
  const legacyUpdates = [];

  for (const account of accounts) {
    const normalized = normalizePhone(account.phone);
    if (!byPhone.has(normalized)) byPhone.set(normalized, []);
    byPhone.get(normalized).push(account);

    if (account.phone !== normalized && /^9\d{9}$/.test(normalized)) {
      legacyUpdates.push({ account, normalized });
    }
  }

  const duplicateGroups = Array.from(byPhone.entries()).filter(([, items]) => items.length > 1);

  if (!duplicateGroups.length) {
    console.log('No duplicate account phone numbers found.');
  } else {
    console.log('Duplicate account phone numbers found:');
    duplicateGroups.forEach(([phone, items]) => {
      console.log(`\nPhone: ${phone}`);
      items.forEach((account) => {
        console.log(`- ${account._id} | ${account.firstName} ${account.lastName} | stored phone: ${account.phone} | role: ${account.role} | status: ${account.status}`);
      });
    });
    console.log('\nReview these records manually before deleting or merging any account.');
  }

  if (process.argv.includes('--fix-legacy-phone-format')) {
    let fixed = 0;
    for (const { account, normalized } of legacyUpdates) {
      const group = byPhone.get(normalized) || [];
      if (group.length > 1) {
        console.log(`Skipped ${account._id}: normalizing ${account.phone} to ${normalized} would collide with another account.`);
        continue;
      }
      account.phone = normalized;
      await account.save();
      fixed += 1;
    }
    console.log(`Normalized ${fixed} legacy phone number(s).`);
  } else if (legacyUpdates.length) {
    console.log(`\n${legacyUpdates.length} legacy phone number(s) can be normalized by running:`);
    console.log('node scripts/check-duplicate-accounts.js --fix-legacy-phone-format');
  }

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});

const bcrypt = require('bcryptjs');
const { env } = require('../src/config/env');
const { connectDatabase, disconnectDatabase } = require('../src/config/database');
const { User } = require('../src/modules/users/user.model');

async function run() {
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || '';
  const firstName = (process.env.ADMIN_FIRST_NAME || 'SCOVRR').trim();
  const lastName = (process.env.ADMIN_LAST_NAME || 'Admin').trim();

  if (!email || !password) {
    throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD explicitly before running create-admin');
  }
  if (password.length < 12) {
    throw new Error('ADMIN_PASSWORD must be at least 12 characters long');
  }

  await connectDatabase();
  const existing = await User.findOne({ email }).select('+passwordHash');
  if (existing) {
    existing.adminRoles = Array.from(new Set([...existing.adminRoles, 'super_admin']));
    existing.status = 'active';
    await existing.save();
    console.info(`Granted super_admin to existing user ${email}. Password was not changed.`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await User.create({ firstName, lastName, email, passwordHash, adminRoles: ['super_admin'] });
  console.info(`Created super_admin user ${email}.`);
}

run()
  .catch((error) => {
    console.error('Unable to create admin:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (env.mongodbUri) await disconnectDatabase().catch(() => undefined);
  });


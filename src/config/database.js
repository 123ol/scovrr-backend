const mongoose = require('mongoose');
const { env } = require('./env');

async function connectDatabase() {
  if (!env.mongodbUri) {
    throw new Error('MONGODB_URI is not configured');
  }

  mongoose.connection.on('connected', () => console.info('MongoDB connected'));
  mongoose.connection.on('error', (error) => console.error('MongoDB error', error));
  mongoose.connection.on('disconnected', () => console.warn('MongoDB disconnected'));

  await mongoose.connect(env.mongodbUri, {
    serverSelectionTimeoutMS: 10_000
  });
}

async function disconnectDatabase() {
  await mongoose.disconnect();
}

module.exports = { connectDatabase, disconnectDatabase };

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

import { User } from './models/User.js';

const MONGODB_URI = process.env.MONGODB_URI;

async function createAdmins() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    const usersToCreate = [
      { username: 'TSO', password: 'tso@2025', role: 'admin' },
      { username: 'KMMZ', password: 'kmmz@2025', role: 'admin' },
      { username: 'MKZ', password: 'mkz@2025', role: 'admin' }
    ];

    for (const userData of usersToCreate) {
      const userExists = await User.findOne({ username: userData.username });
      if (!userExists) {
        await User.create(userData);
        console.log(`Admin user '${userData.username}' created successfully.`);
      } else {
        console.log(`Admin user '${userData.username}' already exists.`);
      }
    }

    console.log('Finished creating admin accounts.');
    process.exit(0);
  } catch (err) {
    console.error('Error creating admin accounts:', err);
    process.exit(1);
  }
}

createAdmins();

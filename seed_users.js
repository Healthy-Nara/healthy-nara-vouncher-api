import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

import { User } from './models/User.js';

const MONGODB_URI = process.env.MONGODB_URI;

async function seedUsers() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    // Create Admin
    const adminExists = await User.findOne({ username: 'admin' });
    if (!adminExists) {
      await User.create({
        username: 'admin',
        password: 'adminpassword',
        role: 'admin'
      });
      console.log('Admin user created');
    }

    // Create Staff
    const staffExists = await User.findOne({ username: 'staff' });
    if (!staffExists) {
      await User.create({
        username: 'staff',
        password: 'staffpassword',
        role: 'staff'
      });
      console.log('Staff user created');
    }

    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

seedUsers();

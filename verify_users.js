import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

import { User } from './models/User.js';

const MONGODB_URI = process.env.MONGODB_URI;

async function verifyUsers() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    const users = await User.find();
    console.log(`Found ${users.length} users:`);
    
    for (const user of users) {
      const isAdminPassCorrect = await user.comparePassword('adminpassword');
      const isStaffPassCorrect = await user.comparePassword('staffpassword');
      
      console.log(`- User: ${user.username}, Role: ${user.role}, PassStart: ${user.password.substring(0, 10)}`);
      console.log(`  Verify adminpassword: ${isAdminPassCorrect}`);
      console.log(`  Verify staffpassword: ${isStaffPassCorrect}`);
    }

    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

verifyUsers();

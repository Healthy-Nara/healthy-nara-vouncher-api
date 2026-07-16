import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { Caregiver } from './models/Caregiver.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/finance-admin';

const seedNAUsers = async () => {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    // Sample NA users to create
    // Username: lowercase name without spaces
    // Password: NRC digits (example)
    const naUsers = [
      { caregiverName: 'Aun Aung', username: 'aungaung', password: '123456', contactNumber: '09123456789', gender: 'Female' },
      { caregiverName: 'May Thin', username: 'maythin', password: '234567', contactNumber: '09234567890', gender: 'Female' },
      { caregiverName: 'Kyaw Zin', username: 'kyawzin', password: '345678', contactNumber: '09345678901', gender: 'Male' },
      { caregiverName: 'Thin Thin', username: 'thinthin', password: '456789', contactNumber: '09456789012', gender: 'Female' },
    ];

    let created = 0;
    let skipped = 0;

    for (const na of naUsers) {
      const existing = await Caregiver.findOne({ username: na.username });
      if (existing) {
        console.log(`Skipped: ${na.username} (already exists)`);
        skipped++;
        continue;
      }

      const caregiver = new Caregiver(na);
      await caregiver.save();
      console.log(`Created: ${na.username} (${na.caregiverName})`);
      created++;
    }

    console.log(`\nSeed complete: ${created} created, ${skipped} skipped`);
    
    // List all caregivers with auth
    const allWithAuth = await Caregiver.find({ username: { $exists: true, $ne: null } })
      .select('caregiverName username');
    console.log('\nAll NAs with login credentials:');
    allWithAuth.forEach(na => {
      console.log(`  - ${na.caregiverName} (@${na.username})`);
    });

  } catch (error) {
    console.error('Seed error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\nDisconnected from MongoDB');
  }
};

seedNAUsers();

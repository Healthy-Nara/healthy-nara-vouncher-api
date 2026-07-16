import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

const { Caregiver } = await import('./models/Caregiver.js');

await mongoose.connect(process.env.MONGODB_URI);
console.log('Connected to MongoDB');

const result = await Caregiver.deleteMany({ caregiverName: { $in: [null, ''] } });
console.log('Deleted', result.deletedCount, 'caregivers with no name');

const remaining = await Caregiver.find();
console.log('\nRemaining caregivers:');
remaining.forEach(c => console.log(' -', c.caregiverName, '|', c.gender, '|', c.township || '-'));

process.exit(0);

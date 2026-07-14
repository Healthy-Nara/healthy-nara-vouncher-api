import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

const stageMap = {
  'New': 'Inquiry',
  'Contacted': 'Qualified Lead',
  'Sale Closed': 'Booked (Sale Closed)',
  'Bookinged': 'Booked (Sale Closed)',
  'Active Customer': 'Need Followup',
  'Lost': 'Sale Reject'
};

async function migrate() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    const Lead = mongoose.model('Lead', new mongoose.Schema({
      stage: { type: String }
    }, { strict: false }));

    for (const [oldStage, newStage] of Object.entries(stageMap)) {
      const result = await Lead.updateMany(
        { stage: oldStage },
        { $set: { stage: newStage } }
      );
      console.log(`"${oldStage}" → "${newStage}": ${result.modifiedCount} document(s) updated`);
    }

    console.log('Migration complete!');
    await mongoose.disconnect();
  } catch (error) {
    console.error('Migration failed:', error.message);
    process.exit(1);
  }
}

migrate();

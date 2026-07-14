import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

const rollbackMap = {
  'Inquiry': 'New',
  'Qualified Lead': 'Contacted',
  'Booked (Sale Closed)': 'Sale Closed',
  'Need Followup': 'Active Customer',
  'Sale Reject': 'Lost'
};

async function rollback() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    const Lead = mongoose.model('Lead', new mongoose.Schema({
      stage: { type: String }
    }, { strict: false }));

    for (const [newStage, oldStage] of Object.entries(rollbackMap)) {
      const result = await Lead.updateMany(
        { stage: newStage },
        { $set: { stage: oldStage } }
      );
      console.log(`"${newStage}" → "${oldStage}": ${result.modifiedCount} document(s) updated`);
    }

    console.log('Rollback complete!');
    await mongoose.disconnect();
  } catch (error) {
    console.error('Rollback failed:', error.message);
    process.exit(1);
  }
}

rollback();

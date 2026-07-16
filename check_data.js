import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

import { Invoice } from './models/Invoice.js';
import { Customer } from './models/Customer.js';
import { Caregiver } from './models/Caregiver.js';

const MONGODB_URI = process.env.MONGODB_URI;

async function checkData() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    const invoiceCount = await Invoice.countDocuments();
    const customerCount = await Customer.countDocuments();
    const caregiverCount = await Caregiver.countDocuments();

    console.log('Data Summary:');
    console.log(`Invoices: ${invoiceCount}`);
    console.log(`Customers: ${customerCount}`);
    console.log(`Caregivers: ${caregiverCount}`);

    if (invoiceCount > 0) {
      const invoices = await Invoice.find().limit(5);
      console.log('Sample Invoices:', JSON.stringify(invoices, null, 2));
    }

    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

checkData();

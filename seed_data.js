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

async function seedData() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    // Create a Customer
    const customer = await Customer.create({
      name: 'John Doe',
      phone: '123456789',
      address: 'Yangon, Myanmar',
      email: 'john@example.com'
    });
    console.log('Sample Customer Created');

    // Create a Caregiver
    const caregiver = await Caregiver.create({
      name: 'Jane Smith',
      phone: '987654321',
      address: 'Mandalay, Myanmar',
      specialization: 'Elderly Care'
    });
    console.log('Sample Caregiver Created');

    // Create an Invoice
    const invoice = await Invoice.create({
      invoiceNumber: `INV-20260420-0001`,
      customer: customer._id,
      customerName: customer.name,
      caregiver: caregiver._id,
      caregiverName: caregiver.name,
      dutyType: 'Elderly Care',
      amount: 50000,
      date: new Date()
    });
    console.log('Sample Invoice Created');

    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

seedData();

import mongoose from 'mongoose';

const caregiverSchema = new mongoose.Schema({
  name: { type: String, required: true },
  phone: { type: String },
  address: { type: String },
  bankInfo: { type: String },
  specialization: { type: String },
  note: { type: String }
}, { timestamps: true });

export const Caregiver = mongoose.model('Caregiver', caregiverSchema);

import mongoose from 'mongoose';

const customerSchema = new mongoose.Schema({
  name: { type: String, required: true },
  phone: { type: String },
  address: { type: String },
  email: { type: String },
  note: { type: String }
}, { timestamps: true });

export const Customer = mongoose.model('Customer', customerSchema);

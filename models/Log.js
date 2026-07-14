import mongoose from 'mongoose';

const logSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  username: { type: String, required: true },
  action: { type: String, required: true },
  details: { type: String },
  resourceType: { type: String }, // e.g., 'Invoice', 'Customer', 'Caregiver'
  resourceId: { type: String },
  timestamp: { type: Date, default: Date.now }
}, { timestamps: true });

export const Log = mongoose.model('Log', logSchema);

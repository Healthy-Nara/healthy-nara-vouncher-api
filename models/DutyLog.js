import mongoose from 'mongoose';

const dutyLogSchema = new mongoose.Schema({
  caregiver: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Caregiver', 
    required: true 
  },
  caregiverName: { type: String, required: true },
  booking: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Booking', 
    required: true 
  },
  parent: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Parent' 
  },
  childName: { type: String },
  date: { type: Date, required: true },
  dutyStart: { type: Date, required: true },
  dutyEnd: { type: Date },
  status: { 
    type: String, 
    enum: ['active', 'completed'], 
    default: 'active' 
  },
  notes: { type: String }
}, { timestamps: true });

// Indexes
dutyLogSchema.index({ caregiver: 1, date: 1 });
dutyLogSchema.index({ status: 1 });
dutyLogSchema.index({ booking: 1 });

export const DutyLog = mongoose.model('DutyLog', dutyLogSchema);

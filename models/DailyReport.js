import mongoose from 'mongoose';

const feedingRecordSchema = new mongoose.Schema({
  type: { 
    type: String, 
    enum: ['breast_milk', 'formula'], 
    required: true 
  },
  time: { type: Date, required: true },
  amount: { type: String, required: true },
  burpingDone: { type: Boolean, default: false },
  airReleased: { type: Boolean, default: false },
  spitUp: { type: Boolean, default: false }
}, { _id: false });

const sleepRecordSchema = new mongoose.Schema({
  type: { 
    type: String, 
    enum: ['day', 'night'], 
    required: true 
  },
  startTime: { type: Date, required: true },
  endTime: { type: Date },
  onSchedule: { type: Boolean, default: true }
}, { _id: false });

const activitySchema = new mongoose.Schema({
  type: { 
    type: String, 
    enum: ['exercise', 'flash_cards', 'story_reading'], 
    required: true 
  },
  time: { type: Date, required: true }
}, { _id: false });

const hygieneSchema = new mongoose.Schema({
  bathTime: { type: Date },
  bathType: { 
    type: String, 
    enum: ['bath', 'sponge_bath'] 
  },
  diaperChanges: { type: Number, default: 0 },
  rashCheck: { type: Boolean, default: false }
}, { _id: false });

const dailyReportSchema = new mongoose.Schema({
  caregiver: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Caregiver', 
    required: true 
  },
  caregiverName: { type: String, required: true },
  parent: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Parent' 
  },
  childName: { type: String, required: true },
  booking: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Booking', 
    required: true 
  },
  date: { type: Date, required: true },
  
  // Nutrition & Feeding
  feedingRecords: [feedingRecordSchema],
  supplementaryFood: { type: String },
  
  // Personal Hygiene
  hygiene: hygieneSchema,
  
  // Sleeping
  sleepRecords: [sleepRecordSchema],
  
  // Activity & Exercise
  activities: [activitySchema],
  
  // Analysis & Unusual Findings
  abnormalities: { type: String },
  
  // Status
  status: { 
    type: String, 
    enum: ['draft', 'submitted'], 
    default: 'draft' 
  },
  submittedAt: { type: Date }
}, { timestamps: true });

// One report per caregiver per date per booking per child
dailyReportSchema.index({ caregiver: 1, date: 1, booking: 1, childName: 1 }, { unique: true });

// Query indexes
dailyReportSchema.index({ date: 1 });
dailyReportSchema.index({ status: 1 });
dailyReportSchema.index({ parent: 1 });

export const DailyReport = mongoose.model('DailyReport', dailyReportSchema);

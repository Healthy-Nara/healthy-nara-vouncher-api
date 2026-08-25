import mongoose from 'mongoose';

const dailyRecordItemSchema = new mongoose.Schema({
  category: { 
    type: String, 
    enum: [
      'Nutrition and Feeding', 
      'Sleeping', 
      'Activity and exercise', 
      'Analysis and Unusual Findings',
      'Personal Hygiene'
    ], 
    required: true 
  },
  time: { type: String, required: true },
  desc: { type: String, required: true }
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
  
  // Dynamic records list
  records: [dailyRecordItemSchema],
  
  // Status
  status: { 
    type: String, 
    enum: ['draft', 'submitted'], 
    default: 'draft' 
  },
  submittedAt: { type: Date },

  // AI Generated Summary
  aiSummary: { type: String },
  aiSummaryGeneratedAt: { type: Date }
}, { timestamps: true });

// One report per caregiver per date per booking per child
dailyReportSchema.index({ caregiver: 1, date: 1, booking: 1, childName: 1 }, { unique: true });

// Query indexes
dailyReportSchema.index({ date: 1 });
dailyReportSchema.index({ status: 1 });
dailyReportSchema.index({ parent: 1 });

export const DailyReport = mongoose.model('DailyReport', dailyReportSchema);

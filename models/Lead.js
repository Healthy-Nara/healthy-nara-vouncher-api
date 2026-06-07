import mongoose from 'mongoose';

const conversationLogSchema = new mongoose.Schema({
  note:      { type: String, required: true },
  staffId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  staffName: { type: String },
  timestamp: { type: Date, default: Date.now },
  isEdited:  { type: Boolean, default: false },
  isDeleted: { type: Boolean, default: false }
});

const leadSchema = new mongoose.Schema({
  customerName:    { type: String, required: true },
  phoneNumber:     { type: String, required: true },
  channel:         { type: String, enum: ['Messenger', 'Phone', 'Viber', 'Walk-in', 'Referral', 'Other'], default: 'Phone' },
  stage:           { type: String, enum: ['New', 'Contacted', 'Sale Closed', 'Bookinged', 'Active Customer', 'Lost'], default: 'New' },
  requirements:    { type: String },
  conversationLogs: [conversationLogSchema],
  assignedStaffId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  assignedStaffName: { type: String },
  tags:            [{ type: String }],
  lostReason:      { type: String },
  notes:           { type: String }
}, { timestamps: true });

export const Lead = mongoose.model('Lead', leadSchema);

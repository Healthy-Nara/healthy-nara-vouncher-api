import mongoose from 'mongoose';

const ticketSchema = new mongoose.Schema({
  title:        { type: String, required: true, trim: true },
  description:  { type: String, required: true },
  status:       { type: String, enum: ['Open', 'In Progress', 'Pending', 'Resolved'], default: 'Open' },
  priority:     { type: String, enum: ['Low', 'Medium', 'High'], default: 'Medium' },
  assigned_to:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  assignedName: { type: String },
  created_by:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  createdByName: { type: String }
}, { timestamps: true });

ticketSchema.index({ status: 1 });
ticketSchema.index({ created_by: 1 });

export const Ticket = mongoose.model('Ticket', ticketSchema);

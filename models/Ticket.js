import mongoose from 'mongoose';

const ticketSchema = new mongoose.Schema({
  title:        { type: String, required: true, trim: true },
  description:  { type: String, required: true },
  status:       { type: String, enum: ['Open', 'In Progress', 'Pending', 'Resolved'], default: 'Open' },
  priority:     { type: String, enum: ['Low', 'Medium', 'High'], default: 'Medium' },
  assigned_to:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  assignedName: { type: String },
  created_by:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  createdByName: { type: String },
  // Links the Telegram notification message back to this ticket so replies can be captured
  telegramNotification: {
    chatId: { type: String },    // e.g. "5123456789"
    messageId: { type: Number }
  }
}, { timestamps: true });

ticketSchema.index({ status: 1 });
ticketSchema.index({ created_by: 1 });

export const Ticket = mongoose.model('Ticket', ticketSchema);

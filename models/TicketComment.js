import mongoose from 'mongoose';

const ticketCommentSchema = new mongoose.Schema({
  ticket_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Ticket', required: true },
  user_id:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  userName:  { type: String },
  message:   { type: String, required: true }
}, { timestamps: true });

ticketCommentSchema.index({ ticket_id: 1, createdAt: 1 });

export const TicketComment = mongoose.model('TicketComment', ticketCommentSchema);

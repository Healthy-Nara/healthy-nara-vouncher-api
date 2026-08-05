import mongoose from 'mongoose';

const expenseSchema = new mongoose.Schema({
  category:       { type: String, required: true },
  amount:         { type: Number, required: true },
  paymentChannel: { type: String, default: 'Cash' },
  description:    { type: String },
  dateTime:       { type: Date, required: true, default: Date.now },
  note:           { type: String }
}, { timestamps: true });

expenseSchema.index({ dateTime: -1 });
expenseSchema.index({ category: 1 });

export const Expense = mongoose.model('Expense', expenseSchema);

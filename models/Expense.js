import mongoose from 'mongoose';

const expenseSchema = new mongoose.Schema({
  category:       { type: String, required: true, enum: ['Rent','Utilities','Salaries & Wages','Transport','Marketing','Supplies','Food & Drinks','Equipment','Other'] },
  amount:         { type: Number, required: true },
  paymentChannel: { type: String, enum: ['KBZPay (Kpay)','AYAPay','WavePay','Cash','Bank','Other'], default: 'Cash' },
  description:    { type: String },
  dateTime:       { type: Date, default: Date.now },
  createdBy:      { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  note:           { type: String }
}, { timestamps: true });

export const Expense = mongoose.model('Expense', expenseSchema);

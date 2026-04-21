import mongoose from 'mongoose';

const caregiverPayoutSchema = new mongoose.Schema({
  invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', required: true },
  paymentChannel: { type: String, required: true },
  payeeAccountName: { type: String, required: true },
  dateTime: { type: Date, required: true },
  note: { type: String }
}, { timestamps: true });

export const CaregiverPayout = mongoose.model('CaregiverPayout', caregiverPayoutSchema);

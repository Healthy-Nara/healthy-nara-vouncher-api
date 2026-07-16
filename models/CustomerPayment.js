import mongoose from 'mongoose';

const customerPaymentSchema = new mongoose.Schema({
  invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', required: true },
  receivedAmount: { type: Number, required: true },
  paymentChannel: { type: String, required: true },
  payerAccountName: { type: String, required: true },
  dateTime: { type: Date, required: true },
  note: { type: String }
}, { timestamps: true });

export const CustomerPayment = mongoose.model('CustomerPayment', customerPaymentSchema);

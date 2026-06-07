import mongoose from 'mongoose';

const invoiceSchema = new mongoose.Schema({
  invoiceNumber: { type: String, required: true, unique: true },
  parent: { type: mongoose.Schema.Types.ObjectId, ref: 'Parent' },
  customerName: { type: String, required: true },
  caregiver: { type: mongoose.Schema.Types.ObjectId, ref: 'Caregiver' },
  caregiverName: { type: String, required: true },
  booking: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking' },
  dutyType: { type: String, required: true, default: 'Newborn Service' },
  servicePackage: { type: String, enum: ['Newborn Service', 'Childcare Service', 'N/A'], default: 'N/A' },
  amount: { type: Number, required: true },
  platformFeeRate: { type: Number, default: 10 },
  platformFee: { type: Number, default: 0 },
  date: { type: Date, required: true },
  serviceStartDate: { type: Date },
  serviceEndDate: { type: Date },
  dueDate: { type: Date },
  paymentMethod: { type: String, default: 'Kpay' },
  invoiceStatus: { type: String, enum: ['Draft', 'Created', 'Sent', 'Payment Confirmed', 'Payout Completed'], default: 'Draft' },
  isLocked: { type: Boolean, default: false },
  customerPaymentStatus: { type: String, enum: ['Pending', 'Received'], default: 'Pending' },
  caregiverPayoutStatus: { type: String, enum: ['Pending', 'Paid'], default: 'Pending' },
  status: { type: String, enum: ['Pending', 'Completed'], default: 'Pending' }
}, { timestamps: true });

export const Invoice = mongoose.model('Invoice', invoiceSchema);

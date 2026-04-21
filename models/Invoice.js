import mongoose from 'mongoose';

const invoiceSchema = new mongoose.Schema({
  invoiceNumber: { type: String, required: true, unique: true },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer' },
  customerName: { type: String, required: true }, // Keep as fallback/display name
  caregiver: { type: mongoose.Schema.Types.ObjectId, ref: 'Caregiver' },
  caregiverName: { type: String, required: true }, // Keep as fallback/display name
  dutyType: { type: String, required: true },
  servicePackage: { type: String, enum: ['Newborn Service', 'Childcare Service', 'N/A'], default: 'N/A' },
  amount: { type: Number, required: true },
  platformFeeRate: { type: Number, default: 10 },
  platformFee: { type: Number, default: 0 },
  date: { type: Date, required: true },
  serviceStartDate: { type: Date },
  serviceEndDate: { type: Date },
  dueDate: { type: Date },
  paymentMethod: { type: String, default: 'Kpay' },
  customerPaymentStatus: { 
    type: String, 
    enum: ['Pending', 'Received'], 
    default: 'Pending' 
  },
  caregiverPayoutStatus: { 
    type: String, 
    enum: ['Pending', 'Paid'], 
    default: 'Pending' 
  },
  status: { 
    type: String, 
    enum: ['Pending', 'Completed'], 
    default: 'Pending' 
  }
}, { timestamps: true });

export const Invoice = mongoose.model('Invoice', invoiceSchema);

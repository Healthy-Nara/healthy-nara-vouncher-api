import mongoose from 'mongoose';

const suggestedCaregiverSchema = new mongoose.Schema({
  caregiver:     { type: mongoose.Schema.Types.ObjectId, ref: 'Caregiver' },
  caregiverName: { type: String }
}, { _id: false });

const bookingSchema = new mongoose.Schema({
  bookingNumber:  { type: String, required: true, unique: true },
  lead:           { type: mongoose.Schema.Types.ObjectId, ref: 'Lead' },
  customerName:   { type: String, required: true },
  phoneNumber:    { type: String, required: true },
  servicePackage: { type: String, enum: ['Newborn Service', 'Childcare Service', 'N/A'], default: 'N/A' },
  dutyType:       { type: String },
  requirements:   { type: String },
  requestedDates: [{ type: Date }],
  status:         { type: String, enum: ['Pending NA Selection', 'Assigned', 'Completed', 'Cancelled'], default: 'Pending NA Selection' },
  selectedCaregiver: { type: mongoose.Schema.Types.ObjectId, ref: 'Caregiver' },
  caregiverName:  { type: String },
  suggestedCaregivers: [suggestedCaregiverSchema],
  invoice:        { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice' },
  bookingToken:   { type: String, unique: true },
  parent:         { type: mongoose.Schema.Types.ObjectId, ref: 'Parent' },
  notes:          { type: String },
  dutyDuration:      { type: String },
  dutyShift:         { type: String },
  dutyStartingtime:  { type: Date },
  additionalNotes:   { type: String }
}, { timestamps: true });

export const Booking = mongoose.model('Booking', bookingSchema);

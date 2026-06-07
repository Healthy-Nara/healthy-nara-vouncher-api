import mongoose from 'mongoose';

const availabilitySchema = new mongoose.Schema({
  date:       { type: Date },
  isBooked:   { type: Boolean, default: false },
  bookingId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Booking' }
}, { _id: false });

const caregiverSchema = new mongoose.Schema({
  caregiverName:  { type: String, required: true },
  contactNumber:  { type: String, required: true },
  gender:         { type: String, enum: ['Male', 'Female'], default: 'Female' },
  township:       { type: String },
  NRC:            { type: String },
  address:        { type: String },
  birthdate:      { type: Date },
  bankInfo:       { type: String },
  specialization: { type: String },
  note:           { type: String },
  availability:   [availabilitySchema]
}, { timestamps: true });

export const Caregiver = mongoose.model('Caregiver', caregiverSchema);

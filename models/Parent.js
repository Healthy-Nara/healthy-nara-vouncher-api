import mongoose from 'mongoose';

const childSchema = new mongoose.Schema({
  childName:              { type: String, required: true },
  birthDate:              { type: Date },
  gender:                 { type: String, enum: ['Male', 'Female'] },
  hasInfectiousDisease:   { type: Boolean, default: false }
});

const parentSchema = new mongoose.Schema({
  parentName:              { type: String, required: true },
  contactNumber:           { type: String },
  leadId:                  { type: mongoose.Schema.Types.ObjectId, ref: 'Lead' },
  township:                { type: String },
  address:                 { type: String },
  religion:                { type: String, enum: ['Buddhist', 'Christian', 'Muslim', 'Hindu', 'Other'] },
  nearestBusStop:          { type: String },
  durationOfBusStopToHome: { type: String },
  children:                [childSchema]
}, { timestamps: true });

export const Parent = mongoose.model('Parent', parentSchema);

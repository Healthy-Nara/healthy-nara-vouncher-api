import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import morgan from 'morgan';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

import { User } from './models/User.js';
import { Invoice } from './models/Invoice.js';
import { CustomerPayment } from './models/CustomerPayment.js';
import { CaregiverPayout } from './models/CaregiverPayout.js';
import { Parent } from './models/Parent.js';
import { Caregiver } from './models/Caregiver.js';
import { Log } from './models/Log.js';
import { Lead } from './models/Lead.js';
import { Booking } from './models/Booking.js';

const app = express();

app.use(express.json());

app.use((req, res, next) => {
  console.log('>>> RECEIVED REQUEST:', req.method, req.url);
  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
    console.log('>>> BODY:', req.body);
  }
  next();
});

app.use(cors());

// --- Authentication Middleware ---
const authMiddleware = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return sendError(res, 'No token provided', 401);

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);
    if (!user) return sendError(res, 'User not found', 401);

    req.user = user;
    next();
  } catch (err) {
    sendError(res, 'Invalid token', 401);
  }
};

const roleMiddleware = (roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    return sendError(res, 'Access denied', 403);
  }
  next();
};

// --- Response Helpers ---
const sendSuccess = (res, data, message = 'Success', statusCode = 200) => {
  res.status(statusCode).json({ success: true, message, data });
};

const sendError = (res, message, statusCode = 400) => {
  res.status(statusCode).json({ success: false, message, data: null });
};

// --- Auth Routes ---
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password, role } = req.body;
    const existingUser = await User.findOne({ username });
    if (existingUser) return sendError(res, 'User already exists', 400);

    const user = new User({ username, password, role });
    await user.save();
    sendSuccess(res, null, 'User created', 201);
  } catch (err) {
    sendError(res, err.message, 400);
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user || !(await user.comparePassword(password))) {
      return sendError(res, 'Invalid credentials', 401);
    }

    const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '1d' });
    
    // Log successful login
    await createLog({ user }, 'Login', 'User', user._id.toString(), `User ${username} logged in`);

    sendSuccess(res, { token, user: { id: user._id, username: user.username, role: user.role } }, 'Login successful');
  } catch (err) {
    sendError(res, err.message, 400);
  }
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  sendSuccess(res, { user: { id: req.user._id, username: req.user.username, role: req.user.role } });
});

app.get('/', (req, res) => {
  sendSuccess(res, null, 'Backend is running');
});

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/finance-admin';
const PORT = process.env.PORT || 5000;

console.log('Using MONGODB_URI:', MONGODB_URI.split('@').pop()); // Log only host for privacy

mongoose.connect(MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => {
    console.error('MongoDB connection error details:', err);
    process.exit(1); // Exit if connection fails
  });

// --- Helper Functions ---
const generateInvoiceNumber = async () => {
  const date = new Date();
  const dateStr = date.toISOString().slice(0, 10).replace(/-/g, ''); // YYYYMMDD
  const count = await Invoice.countDocuments({
    invoiceNumber: { $regex: new RegExp(`^INV-${dateStr}`) }
  });
  const sequence = (count + 1).toString().padStart(4, '0');
  return `INV-${dateStr}-${sequence}`;
};

const generateBookingNumber = async () => {
  const date = new Date();
  const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
  const count = await Booking.countDocuments({
    bookingNumber: { $regex: new RegExp(`^BK-${dateStr}`) }
  });
  const sequence = (count + 1).toString().padStart(4, '0');
  return `BK-${dateStr}-${sequence}`;
};

const generateBookingToken = () => {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
};

const checkAndUpdateInvoiceCompletion = async (invoiceId) => {
  const invoice = await Invoice.findById(invoiceId);
  if (invoice.customerPaymentStatus === 'Received' && invoice.caregiverPayoutStatus === 'Paid') {
    invoice.status = 'Completed';
    await invoice.save();
  }
};

// --- Log Helper ---
const createLog = async (req, action, resourceType, resourceId, details) => {
  try {
    const log = new Log({
      user: req.user._id,
      username: req.user.username,
      action,
      resourceType,
      resourceId,
      details
    });
    await log.save();
  } catch (err) {
    console.error('>>> LOGGING ERROR:', err);
  }
};

// --- Routes ---

// --- Lead Routes ---
app.post('/api/leads', authMiddleware, roleMiddleware(['admin', 'staff']), async (req, res) => {
  try {
    const { customerName, phoneNumber, channel, requirements, assignedStaffId, assignedStaffName, tags, notes } = req.body;
    const lead = new Lead({
      customerName,
      phoneNumber,
      channel,
      requirements,
      assignedStaffId: assignedStaffId || req.user._id,
      assignedStaffName: assignedStaffName || req.user.username,
      tags,
      notes
    });
    await lead.save();
    await createLog(req, 'Create Lead', 'Lead', lead._id.toString(), `Lead ${lead.customerName} created`);
    sendSuccess(res, lead, 'Lead created', 201);
  } catch (error) {
    sendError(res, error.message, 400);
  }
});

app.get('/api/leads', authMiddleware, roleMiddleware(['admin', 'staff']), async (req, res) => {
  try {
    const { stage } = req.query;
    const query = {};
    if (stage) query.stage = stage;
    const leads = await Lead.find(query).sort({ createdAt: -1 });
    sendSuccess(res, leads, 'Leads fetched');
  } catch (error) {
    sendError(res, error.message, 500);
  }
});

app.get('/api/leads/:id', authMiddleware, roleMiddleware(['admin', 'staff']), async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) return sendError(res, 'Lead not found', 404);
    sendSuccess(res, lead, 'Lead fetched');
  } catch (error) {
    sendError(res, error.message, 500);
  }
});

app.put('/api/leads/:id', authMiddleware, roleMiddleware(['admin', 'staff']), async (req, res) => {
  try {
    const lead = await Lead.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!lead) return sendError(res, 'Lead not found', 404);
    await createLog(req, 'Update Lead', 'Lead', lead._id.toString(), `Lead ${lead.customerName} updated`);
    sendSuccess(res, lead, 'Lead updated');
  } catch (error) {
    sendError(res, error.message, 400);
  }
});

app.patch('/api/leads/:id/stage', authMiddleware, roleMiddleware(['admin', 'staff']), async (req, res) => {
  try {
    const { stage, lostReason } = req.body;
    const update = { stage };
    if (stage === 'Lost' && lostReason) update.lostReason = lostReason;
    const lead = await Lead.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!lead) return sendError(res, 'Lead not found', 404);
    await createLog(req, 'Update Lead Stage', 'Lead', lead._id.toString(), `Lead ${lead.customerName} stage changed to ${stage}`);
    sendSuccess(res, lead, 'Stage updated');
  } catch (error) {
    sendError(res, error.message, 400);
  }
});

app.post('/api/leads/:id/logs', authMiddleware, roleMiddleware(['admin', 'staff']), async (req, res) => {
  try {
    const { note } = req.body;
    const lead = await Lead.findById(req.params.id);
    if (!lead) return sendError(res, 'Lead not found', 404);
    lead.conversationLogs.push({
      note,
      staffId: req.user._id,
      staffName: req.user.username,
      timestamp: new Date()
    });
    await lead.save();
    sendSuccess(res, lead, 'Log added');
  } catch (error) {
    sendError(res, error.message, 400);
  }
});

// Edit a conversation log
app.put('/api/leads/:leadId/logs/:logId', authMiddleware, roleMiddleware(['admin', 'staff']), async (req, res) => {
  try {
    const { note } = req.body;
    const lead = await Lead.findById(req.params.leadId);
    if (!lead) return sendError(res, 'Lead not found', 404);
    const idx = parseInt(req.params.logId);
    if (isNaN(idx) || idx < 0 || idx >= lead.conversationLogs.length) {
      return sendError(res, 'Log not found', 404);
    }
    lead.conversationLogs[idx].note = note;
    lead.conversationLogs[idx].isEdited = true;
    await lead.save();
    sendSuccess(res, lead, 'Log updated');
  } catch (error) {
    sendError(res, error.message, 400);
  }
});

// Delete a conversation log (soft delete)
app.delete('/api/leads/:leadId/logs/:logId', authMiddleware, roleMiddleware(['admin', 'staff']), async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.leadId);
    if (!lead) return sendError(res, 'Lead not found', 404);
    const idx = parseInt(req.params.logId);
    if (isNaN(idx) || idx < 0 || idx >= lead.conversationLogs.length) {
      return sendError(res, 'Log not found', 404);
    }
    lead.conversationLogs[idx].note = 'This message was deleted';
    lead.conversationLogs[idx].isDeleted = true;
    await lead.save();
    sendSuccess(res, lead, 'Log deleted');
  } catch (error) {
    sendError(res, error.message, 400);
  }
});

app.post('/api/leads/:id/convert', authMiddleware, roleMiddleware(['admin', 'staff']), async (req, res) => {
  try {
    const { servicePackage, dutyType, requestedDates, requirements } = req.body;
    const lead = await Lead.findById(req.params.id);
    if (!lead) return sendError(res, 'Lead not found', 404);

    // Create Parent from Lead (hybrid: copy + link)
    const parent = new Parent({
      parentName: lead.customerName,
      contactNumber: lead.phoneNumber,
      leadId: lead._id
    });
    await parent.save();

    // Create Booking
    const bookingNumber = await generateBookingNumber();
    const booking = new Booking({
      bookingNumber,
      lead: lead._id,
      customerName: lead.customerName,
      phoneNumber: lead.phoneNumber,
      servicePackage,
      dutyType,
      requirements: requirements || lead.requirements,
      requestedDates,
      bookingToken: generateBookingToken()
    });
    await booking.save();

    // Update Lead stage
    lead.stage = 'Bookinged';
    await lead.save();

    await createLog(req, 'Convert Lead', 'Lead', lead._id.toString(), `Lead ${lead.customerName} converted to Parent + Booking ${bookingNumber}`);

    sendSuccess(res, { parent, booking, lead }, 'Lead converted', 201);
  } catch (error) {
    sendError(res, error.message, 400);
  }
});

app.delete('/api/leads/:id', authMiddleware, roleMiddleware(['admin', 'staff']), async (req, res) => {
  try {
    const lead = await Lead.findByIdAndDelete(req.params.id);
    if (!lead) return sendError(res, 'Lead not found', 404);
    await createLog(req, 'Delete Lead', 'Lead', req.params.id, `Lead ${lead.customerName} deleted`);
    sendSuccess(res, null, 'Lead deleted');
  } catch (error) {
    sendError(res, error.message, 500);
  }
});

// --- Booking Routes ---
app.post('/api/bookings', authMiddleware, roleMiddleware(['admin', 'staff']), async (req, res) => {
  try {
    const { leadId, servicePackage, dutyType, requestedDates, requirements, notes } = req.body;
    const lead = await Lead.findById(leadId);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const bookingNumber = await generateBookingNumber();
    const booking = new Booking({
      bookingNumber,
      lead: lead._id,
      customerName: lead.customerName,
      phoneNumber: lead.phoneNumber,
      servicePackage,
      dutyType,
      requestedDates,
      requirements,
      notes,
      bookingToken: generateBookingToken()
    });
    await booking.save();

    // Update Lead stage
    lead.stage = 'Bookinged';
    await lead.save();

    await createLog(req, 'Create Booking', 'Booking', booking.bookingNumber, `Booking ${bookingNumber} created for ${lead.customerName}`);
    sendSuccess(res, booking, 'Booking created', 201);
  } catch (error) {
    sendError(res, error.message, 400);
  }
});

// Create booking from existing Parent (no Lead)
app.post('/api/bookings/from-parent', authMiddleware, roleMiddleware(['admin', 'staff']), async (req, res) => {
  try {
    const { parentInfo, dutyDuration, dutyShift, requestedDates, additionalNotes } = req.body;
    const parent = await Parent.findById(parentInfo);
    if (!parent) return sendError(res, 'Parent not found', 404);

    const bookingNumber = await generateBookingNumber();
    const booking = new Booking({
      bookingNumber,
      customerName: parent.parentName,
      phoneNumber: parent.contactNumber,
      parent: parent._id,
      status: 'Pending NA Selection',
      dutyDuration,
      dutyShift,
      requestedDates,
      additionalNotes,
      bookingToken: generateBookingToken()
    });
    await booking.save();

    await createLog(req, 'Create Booking', 'Booking', booking.bookingNumber, `Booking ${bookingNumber} created from parent ${parent.parentName}`);
    sendSuccess(res, booking, 'Booking created', 201);
  } catch (error) {
    sendError(res, error.message, 400);
  }
});

app.get('/api/bookings', authMiddleware, roleMiddleware(['admin', 'staff']), async (req, res) => {
  try {
    const { status, leadId } = req.query;
    const query = {};
    if (status) query.status = status;
    if (leadId) query.lead = leadId;
    const bookings = await Booking.find(query)
      .populate('lead', 'customerName phoneNumber channel')
      .populate('selectedCaregiver', 'caregiverName contactNumber')
      .populate('parent', 'parentName contactNumber')
      .sort({ createdAt: -1 });
    sendSuccess(res, bookings, 'Bookings fetched');
  } catch (error) {
    sendError(res, error.message, 500);
  }
});

app.get('/api/bookings/:id', authMiddleware, roleMiddleware(['admin', 'staff']), async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id)
      .populate('lead')
      .populate('selectedCaregiver')
      .populate('suggestedCaregivers.caregiver')
      .populate('invoice')
      .populate('parent');
    if (!booking) return sendError(res, 'Booking not found', 404);
    sendSuccess(res, booking, 'Booking fetched');
  } catch (error) {
    sendError(res, error.message, 500);
  }
});

app.put('/api/bookings/:id', authMiddleware, roleMiddleware(['admin', 'staff']), async (req, res) => {
  try {
    const booking = await Booking.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!booking) return sendError(res, 'Booking not found', 404);
    sendSuccess(res, booking, 'Booking updated');
  } catch (error) {
    sendError(res, error.message, 400);
  }
});

app.get('/api/bookings/:id/match', authMiddleware, roleMiddleware(['admin', 'staff']), async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) return sendError(res, 'Booking not found', 404);

    // Find caregivers not already booked on the requested dates
    const caregivers = await Caregiver.find();
    const matching = caregivers.filter(cg => {
      if (!cg.availability || cg.availability.length === 0) return true;
      const bookedDates = cg.availability.filter(a => a.isBooked).map(a => new Date(a.date).toDateString());
      return !booking.requestedDates.some(d => bookedDates.includes(new Date(d).toDateString()));
    });

    sendSuccess(res, matching, 'Matching caregivers found');
  } catch (error) {
    sendError(res, error.message, 500);
  }
});

app.patch('/api/bookings/:id/assign', authMiddleware, roleMiddleware(['admin', 'staff']), async (req, res) => {
  try {
    const { caregiverId } = req.body;
    const booking = await Booking.findById(req.params.id);
    if (!booking) return sendError(res, 'Booking not found', 404);

    const caregiver = await Caregiver.findById(caregiverId);
    if (!caregiver) return sendError(res, 'Caregiver not found', 404);

    booking.selectedCaregiver = caregiver._id;
    booking.caregiverName = caregiver.caregiverName;
    booking.status = 'Assigned';
    await booking.save();

    // Block caregiver availability
    for (const date of booking.requestedDates) {
      const existing = caregiver.availability.find(a => new Date(a.date).toDateString() === new Date(date).toDateString());
      if (existing) {
        existing.isBooked = true;
        existing.bookingId = booking._id;
      } else {
        caregiver.availability.push({ date, isBooked: true, bookingId: booking._id });
      }
    }
    await caregiver.save();

    // Update Lead stage
    await Lead.findByIdAndUpdate(booking.lead, { stage: 'Active Customer' });

    await createLog(req, 'Assign Booking', 'Booking', booking.bookingNumber, `Booking ${booking.bookingNumber} assigned to ${caregiver.caregiverName}`);
    sendSuccess(res, booking, 'NA assigned successfully');
  } catch (error) {
    sendError(res, error.message, 400);
  }
});

// Update Booking Status (Complete / Cancel)
app.patch('/api/bookings/:id/status', authMiddleware, roleMiddleware(['admin', 'staff']), async (req, res) => {
  try {
    const { status } = req.body;
    if (!['Completed', 'Cancelled'].includes(status)) {
      return sendError(res, 'Invalid status. Must be Completed or Cancelled', 400);
    }

    const booking = await Booking.findById(req.params.id);
    if (!booking) return sendError(res, 'Booking not found', 404);

    booking.status = status;
    await booking.save();

    if ((status === 'Cancelled' || status === 'Completed') && booking.selectedCaregiver) {
      const caregiver = await Caregiver.findById(booking.selectedCaregiver);
      if (caregiver && caregiver.availability) {
        for (const date of booking.requestedDates) {
          const slot = caregiver.availability.find(a =>
            new Date(a.date).toDateString() === new Date(date).toDateString() &&
            a.bookingId?.toString() === booking._id.toString()
          );
          if (slot) {
            slot.isBooked = false;
            slot.bookingId = undefined;
          }
        }
        await caregiver.save();
      }
    }

    const label = status === 'Completed' ? 'completed' : 'cancelled';
    await createLog(req, `${label.charAt(0).toUpperCase() + label.slice(1)} Booking`, 'Booking', booking.bookingNumber, `Booking ${booking.bookingNumber} ${label}`);

    sendSuccess(res, booking, `Booking ${label}`);
  } catch (error) {
    sendError(res, error.message, 400);
  }
});

app.post('/api/bookings/:id/generate-invoice', authMiddleware, roleMiddleware(['admin', 'staff']), async (req, res) => {
  try {
    const { amount, platformFeeRate = 10, platformFeeType = 'percentage' } = req.body;
    const booking = await Booking.findById(req.params.id).populate('selectedCaregiver');
    if (!booking) return sendError(res, 'Booking not found', 404);
    if (!['Assigned', 'Completed'].includes(booking.status)) return sendError(res, 'Booking must be Assigned or Completed first', 400);

    const invoiceNumber = await generateInvoiceNumber();
    const platformFee = platformFeeType === 'fixed' ? platformFeeRate : (amount * platformFeeRate) / 100;

    const invoice = new Invoice({
      invoiceNumber,
      customerName: booking.customerName,
      caregiverName: booking.caregiverName || '',
      booking: booking._id,
      parent: null,
      caregiver: booking.selectedCaregiver || null,
      dutyType: booking.dutyType || 'Newborn Service',
      servicePackage: booking.servicePackage,
      amount,
      platformFeeType,
      platformFeeRate,
      platformFee,
      date: new Date(),
      serviceStartDate: booking.requestedDates?.[0] || null,
      serviceEndDate: booking.requestedDates?.[booking.requestedDates.length - 1] || null,
      additionalCharges: booking.additionalCharges || [],
      invoiceStatus: 'Created'
    });
    await invoice.save();

    booking.invoice = invoice._id;
    await booking.save();

    await createLog(req, 'Generate Invoice from Booking', 'Invoice', invoiceNumber, `Invoice ${invoiceNumber} generated from Booking ${booking.bookingNumber}`);
    sendSuccess(res, invoice, 'Invoice generated', 201);
  } catch (error) {
    sendError(res, error.message, 400);
  }
});

// Public booking form (no auth)
app.get('/api/bookings/public/:token', async (req, res) => {
  try {
    const booking = await Booking.findOne({ bookingToken: req.params.token })
      .populate('parent')
      .populate('suggestedCaregivers.caregiver', 'caregiverName contactNumber specialization');
    if (!booking) return sendError(res, 'Booking not found', 404);
    if (booking.status !== 'Pending NA Selection') return sendError(res, 'Booking is no longer accepting selections', 400);
    sendSuccess(res, booking, 'Booking fetched');
  } catch (error) {
    sendError(res, error.message, 500);
  }
});

// Public: Update parent info via booking token (no auth)
app.put('/api/bookings/public/:token/parent', async (req, res) => {
  try {
    const { parentName, contactNumber, township, address, religion, nearestBusStop, durationOfBusStopToHome } = req.body;
    const booking = await Booking.findOne({ bookingToken: req.params.token });
    if (!booking) return sendError(res, 'Booking not found', 404);

    if (booking.parent) {
      // Update existing parent
      const parent = await Parent.findById(booking.parent);
      if (parent) {
        if (parentName !== undefined) parent.parentName = parentName;
        if (contactNumber !== undefined) parent.contactNumber = contactNumber;
        if (township !== undefined) parent.township = township;
        if (address !== undefined) parent.address = address;
        if (religion !== undefined) parent.religion = religion;
        if (nearestBusStop !== undefined) parent.nearestBusStop = nearestBusStop;
        if (durationOfBusStopToHome !== undefined) parent.durationOfBusStopToHome = durationOfBusStopToHome;
        await parent.save();
      }
    } else {
      // Create new parent and link
      const parent = new Parent({
        parentName: parentName || booking.customerName,
        contactNumber: contactNumber || booking.phoneNumber,
        township,
        address,
        religion,
        nearestBusStop,
        durationOfBusStopToHome
      });
      await parent.save();
      booking.parent = parent._id;
      await booking.save();
    }

    const updatedBooking = await Booking.findOne({ bookingToken: req.params.token })
      .populate('parent')
      .populate('suggestedCaregivers.caregiver', 'caregiverName contactNumber specialization');

    sendSuccess(res, updatedBooking, 'Parent info updated');
  } catch (error) {
    sendError(res, error.message, 400);
  }
});

// Public: Get children (no auth)
app.get('/api/bookings/public/:token/children', async (req, res) => {
  try {
    const booking = await Booking.findOne({ bookingToken: req.params.token }).populate('parent');
    if (!booking) return sendError(res, 'Booking not found', 404);
    if (!booking.parent) return sendSuccess(res, [], 'No children yet');
    const parent = await Parent.findById(booking.parent);
    sendSuccess(res, parent.children || [], 'Children fetched');
  } catch (error) {
    sendError(res, error.message, 500);
  }
});

// Public: Add child (no auth)
app.post('/api/bookings/public/:token/children', async (req, res) => {
  try {
    const booking = await Booking.findOne({ bookingToken: req.params.token });
    if (!booking) return sendError(res, 'Booking not found', 404);

    // Create parent if not exists
    if (!booking.parent) {
      const parent = new Parent({ parentName: booking.customerName, contactNumber: booking.phoneNumber });
      await parent.save();
      booking.parent = parent._id;
      await booking.save();
    }

    const parent = await Parent.findById(booking.parent);
    parent.children.push(req.body);
    await parent.save();
    sendSuccess(res, parent.children, 'Child added', 201);
  } catch (error) {
    sendError(res, error.message, 400);
  }
});

// Public: Delete child by index (no auth)
app.delete('/api/bookings/public/:token/children/:index', async (req, res) => {
  try {
    const booking = await Booking.findOne({ bookingToken: req.params.token }).populate('parent');
    if (!booking) return sendError(res, 'Booking not found', 404);
    if (!booking.parent) return sendError(res, 'No parent data', 404);

    const parent = await Parent.findById(booking.parent);
    const idx = parseInt(req.params.index);
    if (isNaN(idx) || idx < 0 || idx >= parent.children.length) {
      return sendError(res, 'Child not found', 404);
    }
    parent.children.splice(idx, 1);
    await parent.save();
    sendSuccess(res, parent.children, 'Child removed');
  } catch (error) {
    sendError(res, error.message, 400);
  }
});

// Public: Update booking details (dutyDuration, dutyShift, etc.) — no auth, idempotent
app.put('/api/bookings/public/:token/details', async (req, res) => {
  try {
    const booking = await Booking.findOne({ bookingToken: req.params.token });
    if (!booking) return sendError(res, 'Booking not found', 404);

    const { dutyDuration, dutyShift, requestedDates, additionalNotes } = req.body;
    if (dutyDuration !== undefined) booking.dutyDuration = dutyDuration;
    if (dutyShift !== undefined) booking.dutyShift = dutyShift;
    if (requestedDates !== undefined) booking.requestedDates = requestedDates;
    if (additionalNotes !== undefined) booking.additionalNotes = additionalNotes;
    await booking.save();

    sendSuccess(res, booking, 'Booking details updated');
  } catch (error) {
    sendError(res, error.message, 400);
  }
});

app.post('/api/bookings/public/:token/select', async (req, res) => {
  try {
    const { caregiverId } = req.body;
    const booking = await Booking.findOne({ bookingToken: req.params.token });
    if (!booking) return sendError(res, 'Booking not found', 404);
    if (booking.status !== 'Pending NA Selection') return sendError(res, 'Booking is no longer accepting selections', 400);

    const caregiver = await Caregiver.findById(caregiverId);
    if (!caregiver) return sendError(res, 'Caregiver not found', 404);

    booking.selectedCaregiver = caregiver._id;
    booking.caregiverName = caregiver.caregiverName;
    booking.status = 'Assigned';
    await booking.save();

    sendSuccess(res, { message: 'NA selected successfully', booking }, 'NA selected');
  } catch (error) {
    sendError(res, error.message, 400);
  }
});

app.delete('/api/bookings/:id', authMiddleware, roleMiddleware(['admin', 'staff']), async (req, res) => {
  try {
    const booking = await Booking.findByIdAndDelete(req.params.id);
    if (!booking) return sendError(res, 'Booking not found', 404);
    await createLog(req, 'Delete Booking', 'Booking', booking.bookingNumber, `Booking ${booking.bookingNumber} deleted`);
    sendSuccess(res, null, 'Booking deleted');
  } catch (error) {
    sendError(res, error.message, 500);
  }
});

// --- Schedule Routes ---
app.get('/api/schedule', authMiddleware, roleMiddleware(['admin', 'staff']), async (req, res) => {
  try {
    const bookings = await Booking.find({ status: { $in: ['Assigned', 'Completed', 'Pending NA Selection'] } })
      .populate('selectedCaregiver', 'caregiverName contactNumber')
      .sort({ createdAt: -1 });
    sendSuccess(res, bookings, 'Schedule fetched');
  } catch (error) {
    sendError(res, error.message, 500);
  }
});

app.get('/api/caregivers/:id/availability', authMiddleware, roleMiddleware(['admin', 'staff']), async (req, res) => {
  try {
    const caregiver = await Caregiver.findById(req.params.id);
    if (!caregiver) return sendError(res, 'Caregiver not found', 404);
    sendSuccess(res, caregiver.availability || [], 'Availability fetched');
  } catch (error) {
    sendError(res, error.message, 500);
  }
});

// --- Invoice Lock/Unlock Routes ---
app.patch('/api/invoices/:invoiceNumber/lock', authMiddleware, roleMiddleware(['admin', 'staff']), async (req, res) => {
  try {
    const invoice = await Invoice.findOne({ invoiceNumber: req.params.invoiceNumber });
    if (!invoice) return sendError(res, 'Invoice not found', 404);
    invoice.isLocked = true;
    invoice.invoiceStatus = 'Payment Confirmed';
    await invoice.save();
    await createLog(req, 'Lock Invoice', 'Invoice', invoice.invoiceNumber, `Invoice ${invoice.invoiceNumber} locked (Payment Confirmed)`);
    sendSuccess(res, invoice, 'Invoice locked');
  } catch (error) {
    sendError(res, error.message, 400);
  }
});

app.patch('/api/invoices/:invoiceNumber/unlock', authMiddleware, roleMiddleware(['admin', 'staff']), async (req, res) => {
  try {
    const invoice = await Invoice.findOne({ invoiceNumber: req.params.invoiceNumber });
    if (!invoice) return sendError(res, 'Invoice not found', 404);
    invoice.isLocked = false;
    invoice.invoiceStatus = 'Sent';
    await invoice.save();
    await createLog(req, 'Unlock Invoice', 'Invoice', invoice.invoiceNumber, `Invoice ${invoice.invoiceNumber} unlocked`);
    sendSuccess(res, invoice, 'Invoice unlocked');
  } catch (error) {
    sendError(res, error.message, 400);
  }
});

// --- Payout Summary Route ---
app.get('/api/payouts/summary', authMiddleware, roleMiddleware(['admin']), async (req, res) => {
  try {
    const invoices = await Invoice.find({ caregiverPayoutStatus: 'Paid' })
      .populate('caregiver', 'caregiverName contactNumber')
      .sort({ updatedAt: -1 });
    
    const pending = await Invoice.find({ caregiverPayoutStatus: 'Pending', status: { $ne: 'Completed' } })
      .populate('caregiver', 'caregiverName contactNumber')
      .sort({ createdAt: -1 });

    const totalPaid = invoices.reduce((sum, inv) => sum + inv.amount, 0);
    const totalPending = pending.reduce((sum, inv) => sum + inv.amount, 0);

    sendSuccess(res, { paid: invoices, pending, totalPaid, totalPending }, 'Payout summary fetched');
  } catch (error) {
    sendError(res, error.message, 500);
  }
});

// 1. Create Invoice - BOTH admin and staff
app.post('/api/invoices', authMiddleware, async (req, res) => {
  try {
    const { 
      customerName, caregiverName, dutyType, servicePackage, 
      amount, date, serviceStartDate, serviceEndDate, dueDate, 
      parentId, caregiverId, platformFeeRate = 10, platformFeeType = 'percentage' 
    } = req.body;
    
    let resolvedName = customerName;
    if (parentId) {
      const parent = await Parent.findById(parentId);
      if (parent) resolvedName = parent.parentName;
    }
    
    let resolvedCaregiverName = caregiverName;
    if (caregiverId) {
      const caregiver = await Caregiver.findById(caregiverId);
      if (caregiver) resolvedCaregiverName = caregiver.caregiverName;
    }
    
    const invoiceNumber = await generateInvoiceNumber();
    const platformFee = platformFeeType === 'fixed' ? platformFeeRate : (amount * platformFeeRate) / 100;
    
    const invoice = new Invoice({
      invoiceNumber,
      customerName: resolvedName,
      caregiverName: resolvedCaregiverName,
      parent: parentId || null,
      caregiver: caregiverId || null,
      dutyType,
      servicePackage,
      amount,
      platformFeeType,
      platformFeeRate,
      platformFee,
      date,
      serviceStartDate,
      serviceEndDate,
      dueDate
    });
    await invoice.save();
    
    const logDetails = `Invoice ${invoice.invoiceNumber} created for ${resolvedName}. Date: ${date}${dueDate ? `, Due: ${dueDate}` : ''}`;
    await createLog(req, 'Create Invoice', 'Invoice', invoice.invoiceNumber, logDetails);

    sendSuccess(res, invoice, 'Invoice created', 201);
  } catch (error) {
    sendError(res, error.message, 400);
  }
});

// --- Parent Routes ---
app.post('/api/parents', authMiddleware, roleMiddleware(['admin', 'staff']), async (req, res) => {
  try {
    const parent = new Parent(req.body);
    await parent.save();

    await createLog(req, 'Create Parent', 'Parent', parent._id.toString(), `Parent ${parent.parentName} created`);

    sendSuccess(res, parent, 'Parent created', 201);
  } catch (error) {
    sendError(res, error.message, 400);
  }
});

app.get('/api/parents', authMiddleware, roleMiddleware(['admin', 'staff']), async (req, res) => {
  try {
    const parents = await Parent.find().sort({ parentName: 1 });
    sendSuccess(res, parents, 'Parents fetched');
  } catch (error) {
    sendError(res, error.message, 500);
  }
});

app.get('/api/parents/:id', authMiddleware, roleMiddleware(['admin', 'staff']), async (req, res) => {
  try {
    const parent = await Parent.findById(req.params.id);
    if (!parent) return sendError(res, 'Parent not found', 404);
    sendSuccess(res, parent, 'Parent fetched');
  } catch (error) {
    sendError(res, error.message, 500);
  }
});

app.get('/api/parents/:id/bookings', authMiddleware, roleMiddleware(['admin', 'staff']), async (req, res) => {
  try {
    const bookings = await Booking.find({ parent: req.params.id })
      .populate('selectedCaregiver', 'caregiverName contactNumber')
      .sort({ createdAt: -1 });
    sendSuccess(res, bookings, 'Parent bookings fetched');
  } catch (error) {
    sendError(res, error.message, 500);
  }
});

app.put('/api/parents/:id', authMiddleware, roleMiddleware(['admin', 'staff']), async (req, res) => {
  try {
    const parent = await Parent.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!parent) return sendError(res, 'Parent not found', 404);

    await createLog(req, 'Update Parent', 'Parent', parent._id.toString(), `Parent ${parent.parentName} updated`);

    sendSuccess(res, parent, 'Parent updated');
  } catch (error) {
    sendError(res, error.message, 400);
  }
});

// --- Caregiver Routes ---
app.post('/api/caregivers', authMiddleware, roleMiddleware(['admin', 'staff']), async (req, res) => {
  try {
    const caregiver = new Caregiver(req.body);
    await caregiver.save();

    await createLog(req, 'Create Caregiver', 'Caregiver', caregiver._id.toString(), `Caregiver ${caregiver.caregiverName} created`);

    sendSuccess(res, caregiver, 'Caregiver created', 201);
  } catch (e) {
    sendError(res, e.message, 400);
  }
});

app.get('/api/caregivers', authMiddleware, roleMiddleware(['admin', 'staff']), async (req, res) => {
  try {
    const caregivers = await Caregiver.find().sort({ caregiverName: 1 });
    sendSuccess(res, caregivers, 'Caregivers fetched');
  } catch (e) {
    sendError(res, e.message, 500);
  }
});

app.get('/api/caregivers/:id', authMiddleware, roleMiddleware(['admin', 'staff']), async (req, res) => {
  try {
    const caregiver = await Caregiver.findById(req.params.id);
    if (!caregiver) return sendError(res, 'Caregiver not found', 404);
    sendSuccess(res, caregiver, 'Caregiver fetched');
  } catch (error) {
    sendError(res, error.message, 500);
  }
});

app.put('/api/caregivers/:id', authMiddleware, roleMiddleware(['admin', 'staff']), async (req, res) => {
  try {
    const caregiver = await Caregiver.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!caregiver) return sendError(res, 'Caregiver not found', 404);

    await createLog(req, 'Update Caregiver', 'Caregiver', caregiver._id.toString(), `Caregiver ${caregiver.caregiverName} updated`);

    sendSuccess(res, caregiver, 'Caregiver updated');
  } catch (error) {
    sendError(res, error.message, 400);
  }
});

// Caregiver Stats
app.get('/api/caregivers/:id/stats', authMiddleware, roleMiddleware(['admin', 'staff']), async (req, res) => {
  try {
    const caregiver = await Caregiver.findById(req.params.id);
    if (!caregiver) return sendError(res, 'Caregiver not found', 404);

    const invoices = await Invoice.find({ caregiver: req.params.id }).sort({ createdAt: -1 });
    const invoiceIds = invoices.map(inv => inv._id);
    const payouts = await CaregiverPayout.find({ invoiceId: { $in: invoiceIds } });

    const totalPaid = payouts.reduce((sum, p) => sum + (p.amount || 0), 0);
    const totalPending = invoices
      .filter(inv => inv.caregiverPayoutStatus === 'Pending')
      .reduce((sum, inv) => sum + (inv.amount - (inv.platformFee || 0)), 0);

    const bookingIds = invoices.map(inv => inv.booking).filter(Boolean);
    const bookings = await Booking.find({ _id: { $in: bookingIds } })
      .populate('parent', 'parentName contactNumber')
      .sort({ createdAt: -1 });

    sendSuccess(res, {
      caregiver,
      bookings,
      totalPaid,
      totalPending,
      invoiceCount: invoices.length,
      bookingCount: bookings.length,
    }, 'Caregiver stats fetched');
  } catch (error) {
    sendError(res, error.message, 500);
  }
});

// 2. Get All Invoices - ONLY admin
app.get('/api/invoices', authMiddleware, roleMiddleware(['admin', 'staff']), async (req, res) => {
  try {
    const { status, customerPaymentStatus, caregiverPayoutStatus, startDate, endDate } = req.query;
    const query = {};
    if (status) query.status = status;
    if (customerPaymentStatus) query.customerPaymentStatus = customerPaymentStatus;
    if (caregiverPayoutStatus) query.caregiverPayoutStatus = caregiverPayoutStatus;
    
    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.date.$lte = end;
      }
    }
    
    const invoices = await Invoice.find(query).sort({ createdAt: -1 });
    sendSuccess(res, invoices, 'Invoices fetched');
  } catch (error) {
    sendError(res, error.message, 500);
  }
});

// 3. Get Invoice by Number - BOTH admin and staff
app.get('/api/invoices/:invoiceNumber', authMiddleware, async (req, res) => {
  try {
    const invoice = await Invoice.findOne({ invoiceNumber: req.params.invoiceNumber }).lean();
    if (!invoice) return sendError(res, 'Invoice not found', 404);
    
    const payment = await CustomerPayment.findOne({ invoiceId: invoice._id }).sort({ createdAt: -1 });
    const payout = await CaregiverPayout.findOne({ invoiceId: invoice._id }).sort({ createdAt: -1 });
    
    sendSuccess(res, {
      ...invoice,
      paymentDetails: payment,
      payoutDetails: payout
    }, 'Invoice fetched');
  } catch (error) {
    sendError(res, error.message, 500);
  }
});
// 4. Update Customer Payment - ONLY admin
app.post('/api/invoices/:invoiceNumber/payments', authMiddleware, roleMiddleware(['admin', 'staff']), async (req, res) => {
  try {
    const invoice = await Invoice.findOne({ invoiceNumber: req.params.invoiceNumber });
    if (!invoice) return sendError(res, 'Invoice not found', 404);

    const { receivedAmount, paymentChannel, payerAccountName, dateTime, note } = req.body;

    const payment = new CustomerPayment({
      invoiceId: invoice._id,
      receivedAmount,
      paymentChannel,
      payerAccountName,
      dateTime,
      note
    });
    await payment.save();

    invoice.customerPaymentStatus = 'Received';
    // Sync the invoice's paymentMethod with the channel used for the payment
    if (paymentChannel) {
      invoice.paymentMethod = paymentChannel;
    }

    await invoice.save();
    await checkAndUpdateInvoiceCompletion(invoice._id);

    // Log payment update
    await createLog(req, 'Update Payment', 'Invoice', invoice.invoiceNumber, `Payment of ${receivedAmount} received for invoice ${invoice.invoiceNumber}`);

    sendSuccess(res, { payment, invoice }, 'Payment recorded', 201);
  } catch (error) {
    sendError(res, error.message, 400);
  }
});


// 5. Update Caregiver Payout - ONLY admin
app.post('/api/invoices/:invoiceNumber/payouts', authMiddleware, roleMiddleware(['admin', 'staff']), async (req, res) => {
  try {
    const invoice = await Invoice.findOne({ invoiceNumber: req.params.invoiceNumber });
    if (!invoice) return sendError(res, 'Invoice not found', 404);

    const { paymentChannel, payeeAccountName, dateTime, note, amount, secondName, dutyType } = req.body;
    
    const payout = new CaregiverPayout({
      invoiceId: invoice._id,
      paymentChannel,
      payeeAccountName,
      amount: amount || invoice.amount,
      secondName,
      dutyType: dutyType || invoice.dutyType,
      dateTime,
      note
    });
    await payout.save();

    invoice.caregiverPayoutStatus = 'Paid';
    await invoice.save();
    await checkAndUpdateInvoiceCompletion(invoice._id);

    const updatedInvoice = await Invoice.findById(invoice._id);

    // Log payout update
    await createLog(req, 'Update Payout', 'Invoice', invoice.invoiceNumber, `Payout recorded for invoice ${invoice.invoiceNumber}`);

    sendSuccess(res, { payout, invoice: updatedInvoice }, 'Payout recorded', 201);
  } catch (error) {
    sendError(res, error.message, 400);
  }
});

// 6. Update Invoice Data - ONLY admin
app.put('/api/invoices/:invoiceNumber', authMiddleware, roleMiddleware(['admin', 'staff']), async (req, res) => {
  try {
    const invoice = await Invoice.findOne({ invoiceNumber: req.params.invoiceNumber });
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    const { 
      customerName, caregiverName, amount, dutyType, servicePackage, 
      date, serviceStartDate, serviceEndDate, dueDate, 
      paymentMethod, parentId, caregiverId, platformFeeRate, platformFeeType 
    } = req.body;

    if (customerName !== undefined) invoice.customerName = customerName;
    if (caregiverName !== undefined) invoice.caregiverName = caregiverName;

    // Lock amount when payment is confirmed
    if (invoice.customerPaymentStatus === 'Received' && amount !== undefined && amount !== invoice.amount) {
      return sendError(res, 'Cannot edit amount after payment is confirmed', 400);
    }

    if (parentId !== undefined) {
      invoice.parent = parentId || null;
      if (parentId) {
        const parent = await Parent.findById(parentId);
        if (parent) invoice.customerName = parent.parentName;
      }
    }
    if (caregiverId !== undefined) {
      invoice.caregiver = caregiverId || null;
      if (caregiverId) {
        const caregiver = await Caregiver.findById(caregiverId);
        if (caregiver) invoice.caregiverName = caregiver.caregiverName;
      }
    }
    if (amount !== undefined) invoice.amount = amount;
    if (dutyType !== undefined) invoice.dutyType = dutyType;
    if (servicePackage !== undefined) invoice.servicePackage = servicePackage;
    if (date !== undefined) invoice.date = date;
    if (serviceStartDate !== undefined) invoice.serviceStartDate = serviceStartDate;
    if (serviceEndDate !== undefined) invoice.serviceEndDate = serviceEndDate;
    if (dueDate !== undefined) invoice.dueDate = dueDate;
    if (paymentMethod !== undefined) invoice.paymentMethod = paymentMethod;
    if (platformFeeType !== undefined) invoice.platformFeeType = platformFeeType;
    if (platformFeeRate !== undefined) invoice.platformFeeRate = platformFeeRate;

    // Recalculate platformFee if amount, platformFeeRate, or platformFeeType was updated
    if (amount !== undefined || platformFeeRate !== undefined || platformFeeType !== undefined) {
      invoice.platformFee = invoice.platformFeeType === 'fixed'
        ? invoice.platformFeeRate
        : (invoice.amount * invoice.platformFeeRate) / 100;
    }

    await invoice.save();

    // Log invoice update
    await createLog(req, 'Update Invoice', 'Invoice', invoice.invoiceNumber, `Invoice ${invoice.invoiceNumber} details updated`);

    sendSuccess(res, invoice, 'Invoice updated');
  } catch (error) {
    sendError(res, error.message, 400);
  }
});

// 7. Update Invoice Status Directly - ONLY admin
app.patch('/api/invoices/:invoiceNumber/status', authMiddleware, roleMiddleware(['admin', 'staff']), async (req, res) => {
  try {
    const { customerPaymentStatus, caregiverPayoutStatus } = req.body;
    const invoice = await Invoice.findOne({ invoiceNumber: req.params.invoiceNumber });
    if (!invoice) return sendError(res, 'Invoice not found', 404);

    if (customerPaymentStatus) invoice.customerPaymentStatus = customerPaymentStatus;
    if (caregiverPayoutStatus) invoice.caregiverPayoutStatus = caregiverPayoutStatus;

    // Recalculate overall status
    if (invoice.customerPaymentStatus === 'Received' && invoice.caregiverPayoutStatus === 'Paid') {
      invoice.status = 'Completed';
    } else {
      invoice.status = 'Pending';
    }

    await invoice.save();

    // Log status toggle
    await createLog(req, 'Update Status', 'Invoice', invoice.invoiceNumber, `Status updated for invoice ${invoice.invoiceNumber} (Payment: ${invoice.customerPaymentStatus}, Payout: ${invoice.caregiverPayoutStatus})`);

    sendSuccess(res, invoice, 'Status updated');
  } catch (error) {
    sendError(res, error.message, 400);
  }
});

// 8. Delete Invoice - ONLY admin
app.delete('/api/invoices/:invoiceNumber', authMiddleware, roleMiddleware(['admin', 'staff']), async (req, res) => {
  try {
    const invoice = await Invoice.findOneAndDelete({ invoiceNumber: req.params.invoiceNumber });
    if (!invoice) return sendError(res, 'Invoice not found', 404);
    
    // Also cleanup associated records
    await CustomerPayment.deleteMany({ invoiceId: invoice._id });
    await CaregiverPayout.deleteMany({ invoiceId: invoice._id });

    // Log invoice deletion
    await createLog(req, 'Delete Invoice', 'Invoice', invoice.invoiceNumber, `Invoice ${invoice.invoiceNumber} deleted`);
    
    sendSuccess(res, null, 'Invoice and associated records deleted');
  } catch (error) {
    sendError(res, error.message, 500);
  }
});

// 9. Dashboard Stats - ONLY admin
app.get('/api/stats', authMiddleware, roleMiddleware(['admin']), async (req, res) => {
  try {
    const invoices = await Invoice.find();
    const leads = await Lead.find();
    const bookings = await Booking.find();
    
    const stats = {
      totalInvoices: invoices.length,
      totalRevenue: invoices.reduce((sum, inv) => sum + inv.amount + (inv.platformFee || 0), 0),
      totalPayouts: invoices.reduce((sum, inv) => sum + inv.amount, 0),
      totalProfit: invoices.reduce((sum, inv) => sum + (inv.platformFee || 0), 0),
      pendingPayments: invoices.filter(i => i.customerPaymentStatus === 'Pending').reduce((sum, inv) => sum + inv.amount + (inv.platformFee || 0), 0),
      accountsReceivable: invoices.filter(i => i.customerPaymentStatus === 'Pending' || i.invoiceStatus === 'Sent').reduce((sum, inv) => sum + inv.amount + (inv.platformFee || 0), 0),
      pendingPayouts: invoices.filter(i => i.caregiverPayoutStatus === 'Pending').reduce((sum, inv) => sum + inv.amount, 0),
      completedInvoices: invoices.filter(i => i.status === 'Completed').length,
      // Lead stats
      totalLeads: leads.length,
      newLeads: leads.filter(l => l.stage === 'New').length,
      contactedLeads: leads.filter(l => l.stage === 'Contacted').length,
      saleClosedLeads: leads.filter(l => l.stage === 'Sale Closed').length,
      activeCustomers: leads.filter(l => l.stage === 'Active Customer').length,
      lostLeads: leads.filter(l => l.stage === 'Lost').length,
      // Booking stats
      totalBookings: bookings.length,
      pendingBookings: bookings.filter(b => b.status === 'Pending NA Selection').length,
      assignedBookings: bookings.filter(b => b.status === 'Assigned').length,
      completedBookings: bookings.filter(b => b.status === 'Completed').length,
      activeNAs: new Set(bookings.filter(b => b.status === 'Assigned' && b.selectedCaregiver).map(b => b.selectedCaregiver.toString())).size,
      // Invoice status stats
      draftInvoices: invoices.filter(i => i.invoiceStatus === 'Draft').length,
      createdInvoices: invoices.filter(i => i.invoiceStatus === 'Created').length,
      sentInvoices: invoices.filter(i => i.invoiceStatus === 'Sent').length,
      confirmedInvoices: invoices.filter(i => i.invoiceStatus === 'Payment Confirmed').length,
    };
    
    sendSuccess(res, stats, 'Stats fetched');
  } catch (error) {
    sendError(res, error.message, 500);
  }
});

// 10. Financial Report - ONLY admin
app.get('/api/reports/financial', authMiddleware, roleMiddleware(['admin']), async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const dateQuery = {};
    if (startDate || endDate) {
      dateQuery.createdAt = {};
      if (startDate) dateQuery.createdAt.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        dateQuery.createdAt.$lte = end;
      }
    }

    const payments = await CustomerPayment.find(dateQuery).sort({ createdAt: -1 });
    const payouts = await CaregiverPayout.find(dateQuery).sort({ createdAt: -1 });
    const invoices = await Invoice.find(dateQuery).sort({ createdAt: -1 });

    const channelBreakdown = {};
    const channels = ['KBZPay (Kpay)', 'AYAPay', 'WavePay'];

    channels.forEach(ch => {
      channelBreakdown[ch] = { income: 0, payouts: 0, fees: 0, count: 0 };
    });

    let totalIncome = 0;
    let totalPayouts = 0;
    let totalFees = 0;

    payments.forEach(p => {
      const ch = p.paymentChannel || 'KBZPay (Kpay)';
      if (!channelBreakdown[ch]) channelBreakdown[ch] = { income: 0, payouts: 0, fees: 0, count: 0 };
      channelBreakdown[ch].income += p.receivedAmount || 0;
      channelBreakdown[ch].count += 1;
      totalIncome += p.receivedAmount || 0;
    });

    payouts.forEach(p => {
      const ch = p.paymentChannel || 'KBZPay (Kpay)';
      if (!channelBreakdown[ch]) channelBreakdown[ch] = { income: 0, payouts: 0, fees: 0, count: 0 };
      channelBreakdown[ch].payouts += p.amount || 0;
      totalPayouts += p.amount || 0;
    });

    invoices.forEach(inv => {
      totalFees += inv.platformFee || 0;
    });

    const dailyData = {};
    payments.forEach(p => {
      const day = new Date(p.createdAt).toISOString().split('T')[0];
      if (!dailyData[day]) dailyData[day] = { income: 0, payouts: 0, fees: 0 };
      dailyData[day].income += p.receivedAmount || 0;
    });
    payouts.forEach(p => {
      const day = new Date(p.createdAt).toISOString().split('T')[0];
      if (!dailyData[day]) dailyData[day] = { income: 0, payouts: 0, fees: 0 };
      dailyData[day].payouts += p.amount || 0;
    });
    invoices.forEach(inv => {
      const day = new Date(inv.createdAt).toISOString().split('T')[0];
      if (!dailyData[day]) dailyData[day] = { income: 0, payouts: 0, fees: 0 };
      dailyData[day].fees += inv.platformFee || 0;
    });

    sendSuccess(res, {
      totalIncome,
      totalPayouts,
      totalFees,
      netProfit: totalIncome - totalPayouts,
      channelBreakdown,
      dailyData,
      paymentCount: payments.length,
      payoutCount: payouts.length,
    }, 'Financial report fetched');
  } catch (error) {
    sendError(res, error.message, 500);
  }
});

// 11. Get Logs - ONLY admin
app.get('/api/logs', authMiddleware, roleMiddleware(['admin']), async (req, res) => {
  try {
    const logs = await Log.find()
      .sort({ timestamp: -1 })
      .limit(500);
    sendSuccess(res, logs, 'Logs fetched');
  } catch (error) {
    sendError(res, error.message, 500);
  }
});

// --- Parent Routes Delete ---
app.delete('/api/parents/:id', authMiddleware, roleMiddleware(['admin', 'staff']), async (req, res) => {
  try {
    const parentId = req.params.id;
    await Parent.findByIdAndDelete(parentId);
    
    // Set parent reference to null in all associated invoices
    const updateResult = await Invoice.updateMany(
      { parent: parentId },
      { $set: { parent: null } }
    );
    
    console.log(`>>> DELETED Parent ${parentId}. Updated ${updateResult.modifiedCount} invoices.`);
    
    await createLog(req, 'Delete Parent', 'Parent', parentId, `Parent ${parentId} deleted`);

    sendSuccess(res, null, 'Parent deleted and invoices updated');
  } catch (error) {
    console.error('>>> DELETE PARENT ERROR:', error);
    sendError(res, error.message, 500);
  }
});

// --- Caregiver Routes Delete ---
app.delete('/api/caregivers/:id', authMiddleware, roleMiddleware(['admin', 'staff']), async (req, res) => {
  try {
    const caregiverId = req.params.id;
    await Caregiver.findByIdAndDelete(caregiverId);
    
    // Set caregiver reference to null in all associated invoices
    const updateResult = await Invoice.updateMany(
      { caregiver: caregiverId },
      { $set: { caregiver: null } }
    );
    
    console.log(`>>> DELETED Caregiver ${caregiverId}. Updated ${updateResult.modifiedCount} invoices.`);

    // Log caregiver deletion
    await createLog(req, 'Delete Caregiver', 'Caregiver', caregiverId, `Caregiver ${caregiverId} deleted`);

    sendSuccess(res, null, 'Caregiver deleted and invoices updated');
  } catch (error) {
    console.error('>>> DELETE CAREGIVER ERROR:', error);
    sendError(res, error.message, 500);
  }
});

// --- Error Middleware ---
app.use((err, req, res, next) => {
  sendError(res, err.message, err.status || 500);
});

import http from 'http';

const server = http.createServer((req, res) => {
  console.log('--- INCOMING RAW REQUEST:', req.method, req.url);
  app(req, res);
});

if (process.env.NODE_ENV !== 'production') {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT} (0.0.0.0)`);
  });
}

export default app;

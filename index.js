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
import { Customer } from './models/Customer.js';
import { Caregiver } from './models/Caregiver.js';
import { Log } from './models/Log.js';

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
    if (!token) return res.status(401).json({ error: 'No token provided' });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);
    if (!user) return res.status(401).json({ error: 'User not found' });

    req.user = user;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

const roleMiddleware = (roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ error: 'Access denied' });
  }
  next();
};

// --- Auth Routes ---
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password, role } = req.body;
    const existingUser = await User.findOne({ username });
    if (existingUser) return res.status(400).json({ error: 'User already exists' });

    const user = new User({ username, password, role });
    await user.save();
    res.status(201).json({ message: 'User created' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '1d' });
    
    // Log successful login
    await createLog({ user }, 'Login', 'User', user._id.toString(), `User ${username} logged in`);

    res.json({ token, user: { id: user._id, username: user.username, role: user.role } });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  res.json({ user: { id: req.user._id, username: req.user.username, role: req.user.role } });
});

app.get('/', (req, res) => {
  res.send('Backend is running');
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

// 1. Create Invoice - BOTH admin and staff
app.post('/api/invoices', authMiddleware, async (req, res) => {
  try {
    const { 
      customerName, caregiverName, dutyType, servicePackage, 
      amount, date, serviceStartDate, serviceEndDate, dueDate, 
      customerId, caregiverId, platformFeeRate = 10 
    } = req.body;
    
    const invoiceNumber = await generateInvoiceNumber();
    const platformFee = (amount * platformFeeRate) / 100;
    
    const invoice = new Invoice({
      invoiceNumber,
      customerName,
      caregiverName,
      customer: customerId || null,
      caregiver: caregiverId || null,
      dutyType,
      servicePackage,
      amount,
      platformFeeRate,
      platformFee,
      date,
      serviceStartDate,
      serviceEndDate,
      dueDate
    });
    await invoice.save();
    
    // Log invoice creation
    const logDetails = `Invoice ${invoice.invoiceNumber} created for ${customerName}. Date: ${date}${dueDate ? `, Due: ${dueDate}` : ''}`;
    await createLog(req, 'Create Invoice', 'Invoice', invoice.invoiceNumber, logDetails);

    res.status(201).json(invoice);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// --- Customer Routes ---
app.post('/api/customers', authMiddleware, roleMiddleware(['admin']), async (req, res) => {
  try {
    const customer = new Customer(req.body);
    await customer.save();

    // Log customer creation
    await createLog(req, 'Create Customer', 'Customer', customer._id.toString(), `Customer ${customer.name} created`);

    res.status(201).json(customer);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/customers', authMiddleware, roleMiddleware(['admin']), async (req, res) => {
  try {
    const customers = await Customer.find().sort({ name: 1 });
    res.json(customers);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Caregiver Routes ---
app.post('/api/caregivers', authMiddleware, roleMiddleware(['admin']), async (req, res) => {
  try {
    const caregiver = new Caregiver(req.body);
    await caregiver.save();

    // Log caregiver creation
    await createLog(req, 'Create Caregiver', 'Caregiver', caregiver._id.toString(), `Caregiver ${caregiver.name} created`);

    res.status(201).json(caregiver);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/caregivers', authMiddleware, roleMiddleware(['admin']), async (req, res) => {
  try {
    const caregivers = await Caregiver.find().sort({ name: 1 });
    res.json(caregivers);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 2. Get All Invoices - ONLY admin
app.get('/api/invoices', authMiddleware, roleMiddleware(['admin']), async (req, res) => {
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
    res.json(invoices);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3. Get Invoice by Number - BOTH admin and staff
app.get('/api/invoices/:invoiceNumber', authMiddleware, async (req, res) => {
  try {
    const invoice = await Invoice.findOne({ invoiceNumber: req.params.invoiceNumber }).lean();
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    
    const payment = await CustomerPayment.findOne({ invoiceId: invoice._id }).sort({ createdAt: -1 });
    const payout = await CaregiverPayout.findOne({ invoiceId: invoice._id }).sort({ createdAt: -1 });
    
    res.json({
      ...invoice,
      paymentDetails: payment,
      payoutDetails: payout
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
// 4. Update Customer Payment - ONLY admin
app.post('/api/invoices/:invoiceNumber/payments', authMiddleware, roleMiddleware(['admin']), async (req, res) => {
  try {
    const invoice = await Invoice.findOne({ invoiceNumber: req.params.invoiceNumber });
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

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

    res.status(201).json({ payment, invoice });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});


// 5. Update Caregiver Payout - ONLY admin
app.post('/api/invoices/:invoiceNumber/payouts', authMiddleware, roleMiddleware(['admin']), async (req, res) => {
  try {
    const invoice = await Invoice.findOne({ invoiceNumber: req.params.invoiceNumber });
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    const { paymentChannel, payeeAccountName, dateTime, note } = req.body;
    
    const payout = new CaregiverPayout({
      invoiceId: invoice._id,
      paymentChannel,
      payeeAccountName,
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

    res.status(201).json({ payout, invoice: updatedInvoice });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// 6. Update Invoice Data - ONLY admin
app.put('/api/invoices/:invoiceNumber', authMiddleware, roleMiddleware(['admin']), async (req, res) => {
  try {
    const invoice = await Invoice.findOne({ invoiceNumber: req.params.invoiceNumber });
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    const { 
      customerName, caregiverName, amount, dutyType, servicePackage, 
      date, serviceStartDate, serviceEndDate, dueDate, 
      paymentMethod, customerId, caregiverId, platformFeeRate 
    } = req.body;

    if (customerName !== undefined) invoice.customerName = customerName;
    if (caregiverName !== undefined) invoice.caregiverName = caregiverName;
    if (amount !== undefined) invoice.amount = amount;
    if (dutyType !== undefined) invoice.dutyType = dutyType;
    if (servicePackage !== undefined) invoice.servicePackage = servicePackage;
    if (date !== undefined) invoice.date = date;
    if (serviceStartDate !== undefined) invoice.serviceStartDate = serviceStartDate;
    if (serviceEndDate !== undefined) invoice.serviceEndDate = serviceEndDate;
    if (dueDate !== undefined) invoice.dueDate = dueDate;
    if (paymentMethod !== undefined) invoice.paymentMethod = paymentMethod;
    if (customerId !== undefined) invoice.customer = customerId || null;
    if (caregiverId !== undefined) invoice.caregiver = caregiverId || null;
    if (platformFeeRate !== undefined) invoice.platformFeeRate = platformFeeRate;

    // Recalculate platformFee if amount or platformFeeRate was updated
    if (amount !== undefined || platformFeeRate !== undefined) {
      invoice.platformFee = (invoice.amount * invoice.platformFeeRate) / 100;
    }

    await invoice.save();

    // Log invoice update
    await createLog(req, 'Update Invoice', 'Invoice', invoice.invoiceNumber, `Invoice ${invoice.invoiceNumber} details updated`);

    res.json(invoice);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// 7. Update Invoice Status Directly - ONLY admin
app.patch('/api/invoices/:invoiceNumber/status', authMiddleware, roleMiddleware(['admin']), async (req, res) => {
  try {
    const { customerPaymentStatus, caregiverPayoutStatus } = req.body;
    const invoice = await Invoice.findOne({ invoiceNumber: req.params.invoiceNumber });
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

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

    res.json(invoice);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// 8. Delete Invoice - ONLY admin
app.delete('/api/invoices/:invoiceNumber', authMiddleware, roleMiddleware(['admin']), async (req, res) => {
  try {
    const invoice = await Invoice.findOneAndDelete({ invoiceNumber: req.params.invoiceNumber });
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    
    // Also cleanup associated records
    await CustomerPayment.deleteMany({ invoiceId: invoice._id });
    await CaregiverPayout.deleteMany({ invoiceId: invoice._id });

    // Log invoice deletion
    await createLog(req, 'Delete Invoice', 'Invoice', invoice.invoiceNumber, `Invoice ${invoice.invoiceNumber} deleted`);
    
    res.json({ message: 'Invoice and associated records deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 9. Dashboard Stats - ONLY admin
app.get('/api/stats', authMiddleware, roleMiddleware(['admin']), async (req, res) => {
  try {
    const invoices = await Invoice.find();
    
    const stats = {
      totalInvoices: invoices.length,
      totalRevenue: invoices.reduce((sum, inv) => sum + inv.amount + (inv.platformFee || 0), 0),
      totalPayouts: invoices.reduce((sum, inv) => sum + inv.amount, 0),
      totalProfit: invoices.reduce((sum, inv) => sum + (inv.platformFee || 0), 0),
      pendingPayments: invoices.filter(i => i.customerPaymentStatus === 'Pending').reduce((sum, inv) => sum + inv.amount + (inv.platformFee || 0), 0),
      pendingPayouts: invoices.filter(i => i.caregiverPayoutStatus === 'Pending').reduce((sum, inv) => sum + inv.amount, 0),
      completedInvoices: invoices.filter(i => i.status === 'Completed').length,
    };
    
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 10. Get Logs - ONLY admin
app.get('/api/logs', authMiddleware, roleMiddleware(['admin']), async (req, res) => {
  try {
    const logs = await Log.find()
      .sort({ timestamp: -1 })
      .limit(500);
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Customer Routes Delete ---
app.delete('/api/customers/:id', authMiddleware, roleMiddleware(['admin']), async (req, res) => {
  try {
    const customerId = req.params.id;
    await Customer.findByIdAndDelete(customerId);
    
    // Set customer reference to null in all associated invoices
    const updateResult = await Invoice.updateMany(
      { customer: customerId },
      { $set: { customer: null } }
    );
    
    console.log(`>>> DELETED Customer ${customerId}. Updated ${updateResult.modifiedCount} invoices.`);
    
    // Log customer deletion
    await createLog(req, 'Delete Customer', 'Customer', customerId, `Customer ${customerId} deleted`);

    res.json({ message: 'Customer deleted and invoices updated' });
  } catch (error) {
    console.error('>>> DELETE CUSTOMER ERROR:', error);
    res.status(500).json({ error: error.message });
  }
});

// --- Caregiver Routes Delete ---
app.delete('/api/caregivers/:id', authMiddleware, roleMiddleware(['admin']), async (req, res) => {
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

    res.json({ message: 'Caregiver deleted and invoices updated' });
  } catch (error) {
    console.error('>>> DELETE CAREGIVER ERROR:', error);
    res.status(500).json({ error: error.message });
  }
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

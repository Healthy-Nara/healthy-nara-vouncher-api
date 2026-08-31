import dns from "node:dns";
import mongoose from "mongoose";

// Local မှာ Run နေချိန် (Production မဟုတ်ချိန်) မှသာ DNS ကို ၁.၁.၁.၁ ပြောင်းခိုင်းမည်
if (process.env.NODE_ENV !== "production") {
  dns.setServers(["1.1.1.1", "8.8.8.8"]);
}
import express from "express";
import cors from "cors";
import morgan from "morgan";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, ".env") });

import { User } from "./models/User.js";
import { Invoice } from "./models/Invoice.js";
import { CustomerPayment } from "./models/CustomerPayment.js";
import { CaregiverPayout } from "./models/CaregiverPayout.js";
import { Parent } from "./models/Parent.js";
import { Caregiver } from "./models/Caregiver.js";
import { Log } from "./models/Log.js";
import { Lead } from "./models/Lead.js";
import { Booking } from "./models/Booking.js";
import { DailyReport } from "./models/DailyReport.js";
import { DutyLog } from "./models/DutyLog.js";
import { Expense } from "./models/Expense.js";
import { Ticket } from "./models/Ticket.js";
import { TicketComment } from "./models/TicketComment.js";
import { TicketHistory } from "./models/TicketHistory.js";
import { Blog } from "./models/Blog.js";
import { initTelegramService, initTelegramWebhook, getTelegramWebhookStatus, notifyTicketAssigned, notifyTicketCommented, processIncomingMessage, processTicketCallback } from "./telegramService.js";

const app = express();

app.use(express.json());

app.use((req, res, next) => {
  console.log(">>> RECEIVED REQUEST:", req.method, req.url);
  if (req.method === "POST" || req.method === "PUT" || req.method === "PATCH") {
    console.log(">>> BODY:", req.body);
  }
  next();
});

app.use(cors());

// --- Authentication Middleware ---
const authMiddleware = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return sendError(res, "No token provided", 401);

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Try User first
    const user = await User.findById(decoded.id);
    if (user) {
      if (!user.isActive) return sendError(res, "Account is disabled", 401);
      req.user = user;
      return next();
    }

    // Fallback to Caregiver (NA)
    const caregiver = await Caregiver.findById(decoded.id);
    if (caregiver) {
      req.user = {
        _id: caregiver._id,
        username: caregiver.username,
        role: "staff",
      };
      return next();
    }

    return sendError(res, "User not found", 401);
  } catch (err) {
    sendError(res, "Invalid token", 401);
  }
};

const roleMiddleware = (roles) => (req, res, next) => {
  // superadmin is a superset of admin — it passes any role gate
  if (req.user.role !== "superadmin" && !roles.includes(req.user.role)) {
    return sendError(res, "Access denied", 403);
  }
  next();
};

// --- NA Auth Middleware ---
const naAuthMiddleware = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return sendError(res, "No token provided", 401);

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const caregiver = await Caregiver.findById(decoded.id);
    if (!caregiver) return sendError(res, "NA not found", 401);

    req.caregiver = caregiver;
    next();
  } catch (err) {
    sendError(res, "Invalid token", 401);
  }
};

// Helper: Generate unique username from name
const generateUsername = async (name) => {
  const base = name.toLowerCase().replace(/\s/g, "");
  let username = base;
  let counter = 1;

  while (await Caregiver.findOne({ username })) {
    username = `${base}${counter}`;
    counter++;
  }

  return username;
};

// Extract password from NRC (last numeric part)
const extractPassword = (nrc) => {
  if (!nrc) return "123456";
  const match = nrc.match(/(\d+)$/); // "12/lamana(P)001233" → "001233"
  return match ? match[1] : "123456";
};

// --- Response Helpers ---
const sendSuccess = (res, data, message = "Success", statusCode = 200) => {
  res.status(statusCode).json({ success: true, message, data });
};

const sendError = (res, message, statusCode = 400) => {
  res.status(statusCode).json({ success: false, message, data: null });
};

// --- Auth Routes ---
app.post("/api/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user || !(await user.comparePassword(password))) {
      return sendError(res, "Invalid credentials", 401);
    }
    if (!user.isActive) return sendError(res, "Account is disabled", 403);

    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "1d" },
    );

    // Log successful login
    await createLog(
      { user },
      "Login",
      "User",
      user._id.toString(),
      `User ${username} logged in`,
    );

    sendSuccess(
      res,
      {
        token,
        user: { id: user._id, username: user.username, role: user.role },
      },
      "Login successful",
    );
  } catch (err) {
    sendError(res, err.message, 400);
  }
});

app.get("/api/auth/me", authMiddleware, (req, res) => {
  sendSuccess(res, {
    user: {
      id: req.user._id,
      username: req.user.username,
      role: req.user.role,
    },
  });
});

app.get("/", (req, res) => {
  sendSuccess(res, null, "Backend is running");
});

const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://localhost:27017/finance-admin";
const PORT = process.env.PORT || 5000;

console.log("Using MONGODB_URI:", MONGODB_URI.split("@").pop()); // Log only host for privacy

mongoose
  .connect(MONGODB_URI)
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => {
    console.error("MongoDB connection error details:", err);
  });

// --- Helper Functions ---
const generateInvoiceNumber = async () => {
  const date = new Date();
  const dateStr = date.toISOString().slice(0, 10).replace(/-/g, ""); // YYYYMMDD
  const lastInvoice = await Invoice.findOne({
    invoiceNumber: { $regex: new RegExp(`^INV-${dateStr}`) },
  }).sort({ invoiceNumber: -1 });

  let nextSeq = 1;
  if (lastInvoice) {
    const lastSeqStr = lastInvoice.invoiceNumber.split("-")[2];
    nextSeq = parseInt(lastSeqStr, 10) + 1;
  }
  const sequence = nextSeq.toString().padStart(4, "0");
  return `INV-${dateStr}-${sequence}`;
};

const generateBookingNumber = async () => {
  const date = new Date();
  const dateStr = date.toISOString().slice(0, 10).replace(/-/g, "");
  const lastBooking = await Booking.findOne({
    bookingNumber: { $regex: new RegExp(`^BK-${dateStr}`) },
  }).sort({ bookingNumber: -1 });

  let nextSeq = 1;
  if (lastBooking) {
    const lastSeqStr = lastBooking.bookingNumber.split("-")[2];
    nextSeq = parseInt(lastSeqStr, 10) + 1;
  }
  const sequence = nextSeq.toString().padStart(4, "0");
  return `BK-${dateStr}-${sequence}`;
};

const generateBookingToken = () => {
  return (
    Math.random().toString(36).substring(2, 15) +
    Math.random().toString(36).substring(2, 15)
  );
};

const checkAndUpdateInvoiceCompletion = async (invoiceId) => {
  const invoice = await Invoice.findById(invoiceId);
  if (
    invoice.customerPaymentStatus === "Received" &&
    invoice.caregiverPayoutStatus === "Paid"
  ) {
    invoice.status = "Completed";
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
      details,
    });
    await log.save();
  } catch (err) {
    console.error(">>> LOGGING ERROR:", err);
  }
};

// --- Routes ---

// --- Lead Routes ---
app.post(
  "/api/leads",
  authMiddleware,
  roleMiddleware(["admin", "staff"]),
  async (req, res) => {
    try {
      const {
        customerName,
        phoneNumber,
        channel,
        requirements,
        assignedStaffId,
        assignedStaffName,
        tags,
        notes,
      } = req.body;
      const lead = new Lead({
        customerName,
        phoneNumber,
        channel,
        requirements,
        assignedStaffId: assignedStaffId || req.user._id,
        assignedStaffName: assignedStaffName || req.user.username,
        tags,
        notes,
      });
      await lead.save();
      await createLog(
        req,
        "Create Lead",
        "Lead",
        lead._id.toString(),
        `Lead ${lead.customerName} created`,
      );
      sendSuccess(res, lead, "Lead created", 201);
    } catch (error) {
      sendError(res, error.message, 400);
    }
  },
);

app.get(
  "/api/leads",
  authMiddleware,
  roleMiddleware(["admin", "staff"]),
  async (req, res) => {
    try {
      const { stage } = req.query;
      const query = {};
      if (stage) query.stage = stage;
      const leads = await Lead.find(query).sort({ createdAt: -1 });
      sendSuccess(res, leads, "Leads fetched");
    } catch (error) {
      sendError(res, error.message, 500);
    }
  },
);

app.get(
  "/api/leads/:id",
  authMiddleware,
  roleMiddleware(["admin", "staff"]),
  async (req, res) => {
    try {
      const lead = await Lead.findById(req.params.id);
      if (!lead) return sendError(res, "Lead not found", 404);
      sendSuccess(res, lead, "Lead fetched");
    } catch (error) {
      sendError(res, error.message, 500);
    }
  },
);

app.put(
  "/api/leads/:id",
  authMiddleware,
  roleMiddleware(["admin", "staff"]),
  async (req, res) => {
    try {
      const lead = await Lead.findByIdAndUpdate(req.params.id, req.body, {
        new: true,
        runValidators: true,
      });
      if (!lead) return sendError(res, "Lead not found", 404);
      await createLog(
        req,
        "Update Lead",
        "Lead",
        lead._id.toString(),
        `Lead ${lead.customerName} updated`,
      );
      sendSuccess(res, lead, "Lead updated");
    } catch (error) {
      sendError(res, error.message, 400);
    }
  },
);

app.patch(
  "/api/leads/:id/stage",
  authMiddleware,
  roleMiddleware(["admin", "staff"]),
  async (req, res) => {
    try {
      const { stage, lostReason } = req.body;
      const update = { stage };
      if (stage === "Lost" && lostReason) update.lostReason = lostReason;
      const lead = await Lead.findByIdAndUpdate(req.params.id, update, {
        new: true,
      });
      if (!lead) return sendError(res, "Lead not found", 404);
      await createLog(
        req,
        "Update Lead Stage",
        "Lead",
        lead._id.toString(),
        `Lead ${lead.customerName} stage changed to ${stage}`,
      );
      sendSuccess(res, lead, "Stage updated");
    } catch (error) {
      sendError(res, error.message, 400);
    }
  },
);

app.post(
  "/api/leads/:id/logs",
  authMiddleware,
  roleMiddleware(["admin", "staff"]),
  async (req, res) => {
    try {
      const { note } = req.body;
      const lead = await Lead.findById(req.params.id);
      if (!lead) return sendError(res, "Lead not found", 404);
      lead.conversationLogs.push({
        note,
        staffId: req.user._id,
        staffName: req.user.username,
        timestamp: new Date(),
      });
      await lead.save();
      sendSuccess(res, lead, "Log added");
    } catch (error) {
      sendError(res, error.message, 400);
    }
  },
);

// Edit a conversation log
app.put(
  "/api/leads/:leadId/logs/:logId",
  authMiddleware,
  roleMiddleware(["admin", "staff"]),
  async (req, res) => {
    try {
      const { note } = req.body;
      const lead = await Lead.findById(req.params.leadId);
      if (!lead) return sendError(res, "Lead not found", 404);
      const idx = parseInt(req.params.logId);
      if (isNaN(idx) || idx < 0 || idx >= lead.conversationLogs.length) {
        return sendError(res, "Log not found", 404);
      }
      lead.conversationLogs[idx].note = note;
      lead.conversationLogs[idx].isEdited = true;
      await lead.save();
      sendSuccess(res, lead, "Log updated");
    } catch (error) {
      sendError(res, error.message, 400);
    }
  },
);

// Delete a conversation log (soft delete)
app.delete(
  "/api/leads/:leadId/logs/:logId",
  authMiddleware,
  roleMiddleware(["admin", "staff"]),
  async (req, res) => {
    try {
      const lead = await Lead.findById(req.params.leadId);
      if (!lead) return sendError(res, "Lead not found", 404);
      const idx = parseInt(req.params.logId);
      if (isNaN(idx) || idx < 0 || idx >= lead.conversationLogs.length) {
        return sendError(res, "Log not found", 404);
      }
      lead.conversationLogs[idx].note = "This message was deleted";
      lead.conversationLogs[idx].isDeleted = true;
      await lead.save();
      sendSuccess(res, lead, "Log deleted");
    } catch (error) {
      sendError(res, error.message, 400);
    }
  },
);

app.post(
  "/api/leads/:id/convert",
  authMiddleware,
  roleMiddleware(["admin", "staff"]),
  async (req, res) => {
    try {
      const { servicePackage, dutyType, requestedDates, requirements } =
        req.body;
      const lead = await Lead.findById(req.params.id);
      if (!lead) return sendError(res, "Lead not found", 404);

      // Create Parent from Lead (hybrid: copy + link)
      const parent = new Parent({
        parentName: lead.customerName,
        contactNumber: lead.phoneNumber,
        leadId: lead._id,
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
        bookingToken: generateBookingToken(),
      });
      await booking.save();

      // Update Lead stage
      lead.stage = "Bookinged";
      await lead.save();

      await createLog(
        req,
        "Convert Lead",
        "Lead",
        lead._id.toString(),
        `Lead ${lead.customerName} converted to Parent + Booking ${bookingNumber}`,
      );

      sendSuccess(res, { parent, booking, lead }, "Lead converted", 201);
    } catch (error) {
      sendError(res, error.message, 400);
    }
  },
);

app.delete(
  "/api/leads/:id",
  authMiddleware,
  roleMiddleware(["admin", "staff"]),
  async (req, res) => {
    try {
      const lead = await Lead.findByIdAndDelete(req.params.id);
      if (!lead) return sendError(res, "Lead not found", 404);
      await createLog(
        req,
        "Delete Lead",
        "Lead",
        req.params.id,
        `Lead ${lead.customerName} deleted`,
      );
      sendSuccess(res, null, "Lead deleted");
    } catch (error) {
      sendError(res, error.message, 500);
    }
  },
);

// --- Booking Routes ---
app.post(
  "/api/bookings",
  authMiddleware,
  roleMiddleware(["admin", "staff"]),
  async (req, res) => {
    try {
      const {
        leadId,
        servicePackage,
        dutyType,
        requestedDates,
        requirements,
        notes,
      } = req.body;
      const lead = await Lead.findById(leadId);
      if (!lead) return res.status(404).json({ error: "Lead not found" });

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
        bookingToken: generateBookingToken(),
      });
      await booking.save();

      // Update Lead stage
      lead.stage = "Bookinged";
      await lead.save();

      await createLog(
        req,
        "Create Booking",
        "Booking",
        booking.bookingNumber,
        `Booking ${bookingNumber} created for ${lead.customerName}`,
      );
      sendSuccess(res, booking, "Booking created", 201);
    } catch (error) {
      sendError(res, error.message, 400);
    }
  },
);

// Create booking from existing Parent (no Lead)
app.post(
  "/api/bookings/from-parent",
  authMiddleware,
  roleMiddleware(["admin", "staff"]),
  async (req, res) => {
    try {
      const {
        parentId,
        parentInfo,
        parent: parentParam,
        servicePackage,
        dutyDuration,
        dutyShift,
        requestedDates,
        additionalNotes,
      } = req.body;
      const targetParentId = parentId || parentInfo || parentParam;
      if (!targetParentId) {
        return sendError(res, "Parent ID is required", 400);
      }
      const parent = await Parent.findById(targetParentId);
      if (!parent) return sendError(res, "Parent not found", 404);

      const bookingNumber = await generateBookingNumber();
      const booking = new Booking({
        bookingNumber,
        customerName: parent.parentName,
        phoneNumber: parent.contactNumber,
        parent: parent._id,
        status: "Pending NA Selection",
        servicePackage: servicePackage || parent.servicePackage,
        dutyDuration,
        dutyShift,
        requestedDates,
        additionalNotes,
        bookingToken: generateBookingToken(),
      });
      await booking.save();

      await createLog(
        req,
        "Create Booking",
        "Booking",
        booking.bookingNumber,
        `Booking ${bookingNumber} created from parent ${parent.parentName}`,
      );
      sendSuccess(res, booking, "Booking created", 201);
    } catch (error) {
      sendError(res, error.message, 400);
    }
  },
);

app.post(
  "/api/bookings/import",
  authMiddleware,
  roleMiddleware(["admin", "staff"]),
  async (req, res) => {
    try {
      const { bookings } = req.body;
      if (!bookings || !Array.isArray(bookings)) {
        return sendError(res, "Invalid bookings list format", 400);
      }

      const imported = [];
      const errors = [];

      for (let i = 0; i < bookings.length; i++) {
        const item = bookings[i];

        try {
          // If booking ID or Booking Number is provided, try updating first
          let existingBooking = null;
          if (item.bookingId) {
            // check if valid ObjectId
            if (mongoose.Types.ObjectId.isValid(item.bookingId)) {
              existingBooking = await Booking.findById(item.bookingId);
            }
            if (!existingBooking) {
              existingBooking = await Booking.findOne({ bookingNumber: item.bookingId });
            }
          }

          if (existingBooking) {
            existingBooking.status = item.status || existingBooking.status;
            existingBooking.dutyDuration = item.dutyDuration || existingBooking.dutyDuration;
            existingBooking.dutyShift = item.dutyShift || existingBooking.dutyShift;
            if (item.dutyStartDate) {
              existingBooking.requestedDates = [new Date(item.dutyStartDate)];
            }
            existingBooking.additionalNotes = item.additionalNotes || existingBooking.additionalNotes;
            await existingBooking.save();

            await createLog(
              req,
              "Update Booking Import",
              "Booking",
              existingBooking.bookingNumber,
              `Booking ${existingBooking.bookingNumber} status updated to ${existingBooking.status} via Excel`,
            );

            imported.push(existingBooking);
            continue;
          }

          // Fallback to Create if booking does not exist
          if (!item.parentName || !item.parentPhone) {
            errors.push({ index: i, error: "Parent Name and Parent Phone are required for new bookings" });
            continue;
          }

          // Find or create Parent
          let parent = await Parent.findOne({
            parentName: item.parentName,
            contactNumber: item.parentPhone,
          });

          if (!parent) {
            parent = new Parent({
              parentName: item.parentName,
              contactNumber: item.parentPhone,
              township: item.parentTownship || "",
              address: item.parentAddress || "",
              religion: "Buddhist",
              children: [],
            });
          }

          // Check if child needs to be added
          if (item.childName) {
            const hasChild = parent.children.some(
              (c) => c.childName.toLowerCase() === item.childName.toLowerCase()
            );
            if (!hasChild) {
              parent.children.push({
                childName: item.childName,
                birthDate: item.childBirthDate ? new Date(item.childBirthDate) : undefined,
                gender: "Male",
                hasInfectiousDisease: false,
              });
            }
          }

          await parent.save();

          // Create Booking
          const bookingNumber = await generateBookingNumber();
          const booking = new Booking({
            bookingNumber,
            customerName: parent.parentName,
            phoneNumber: parent.contactNumber,
            parent: parent._id,
            status: item.status || "Pending NA Selection",
            dutyDuration: item.dutyDuration || "daily",
            dutyShift: item.dutyShift || "day",
            requestedDates: item.dutyStartDate ? [new Date(item.dutyStartDate)] : [],
            additionalNotes: item.additionalNotes || "",
            bookingToken: generateBookingToken(),
          });

          await booking.save();

          await createLog(
            req,
            "Import Booking",
            "Booking",
            booking.bookingNumber,
            `Booking ${bookingNumber} imported via Excel`,
          );

          imported.push(booking);
        } catch (err) {
          errors.push({ index: i, error: err.message });
        }
      }

      sendSuccess(res, { importedCount: imported.length, errors }, `Imported ${imported.length} bookings with ${errors.length} errors.`);
    } catch (error) {
      sendError(res, error.message, 500);
    }
  },
);

app.get(
  "/api/bookings",
  authMiddleware,
  roleMiddleware(["admin", "staff"]),
  async (req, res) => {
    try {
      const { status, leadId, excludeStatuses } = req.query;
      const query = {};
      if (status) query.status = status;
      if (leadId) query.lead = leadId;
      if (excludeStatuses) {
        query.status = { $nin: excludeStatuses.split(",") };
      }

      // Filter by selectedCaregiver if the user is a Caregiver
      const isCaregiver = await Caregiver.exists({ _id: req.user._id });
      if (isCaregiver) {
        query.selectedCaregiver = req.user._id;
      }

      const bookings = await Booking.find(query)
        .populate("lead", "customerName phoneNumber channel")
        .populate("selectedCaregiver", "caregiverName contactNumber")
        .populate("parent", "parentName contactNumber")
        .sort({ createdAt: -1 });
      sendSuccess(res, bookings, "Bookings fetched");
    } catch (error) {
      sendError(res, error.message, 500);
    }
  },
);

app.get(
  "/api/bookings/:id",
  authMiddleware,
  roleMiddleware(["admin", "staff"]),
  async (req, res) => {
    try {
      const booking = await Booking.findById(req.params.id)
        .populate("lead")
        .populate("selectedCaregiver")
        .populate("suggestedCaregivers.caregiver")
        .populate("invoice")
        .populate("parent");
      if (!booking) return sendError(res, "Booking not found", 404);
      sendSuccess(res, booking, "Booking fetched");
    } catch (error) {
      sendError(res, error.message, 500);
    }
  },
);

app.put(
  "/api/bookings/:id",
  authMiddleware,
  roleMiddleware(["admin", "staff"]),
  async (req, res) => {
    try {
      const booking = await Booking.findByIdAndUpdate(req.params.id, req.body, {
        new: true,
        runValidators: true,
      });
      if (!booking) return sendError(res, "Booking not found", 404);
      sendSuccess(res, booking, "Booking updated");
    } catch (error) {
      sendError(res, error.message, 400);
    }
  },
);

app.get(
  "/api/bookings/:id/match",
  authMiddleware,
  roleMiddleware(["admin", "staff"]),
  async (req, res) => {
    try {
      const booking = await Booking.findById(req.params.id);
      if (!booking) return sendError(res, "Booking not found", 404);

      // Find caregivers not already booked on the requested dates
      const caregivers = await Caregiver.find();
      const matching = caregivers.filter((cg) => {
        if (!cg.availability || cg.availability.length === 0) return true;
        const bookedDates = cg.availability
          .filter((a) => a.isBooked)
          .map((a) => new Date(a.date).toDateString());
        return !booking.requestedDates.some((d) =>
          bookedDates.includes(new Date(d).toDateString()),
        );
      });

      sendSuccess(res, matching, "Matching caregivers found");
    } catch (error) {
      sendError(res, error.message, 500);
    }
  },
);

app.patch(
  "/api/bookings/:id/assign",
  authMiddleware,
  roleMiddleware(["admin", "staff"]),
  async (req, res) => {
    try {
      const { caregiverId } = req.body;
      const booking = await Booking.findById(req.params.id).populate("parent");
      if (!booking) return sendError(res, "Booking not found", 404);

      const caregiver = await Caregiver.findById(caregiverId);
      if (!caregiver) return sendError(res, "Caregiver not found", 404);

      booking.selectedCaregiver = caregiver._id;
      booking.caregiverName = caregiver.caregiverName;
      booking.status = "Assigned";
      await booking.save();

      // Block caregiver availability
      for (const date of booking.requestedDates) {
        const existing = caregiver.availability.find(
          (a) =>
            new Date(a.date).toDateString() === new Date(date).toDateString(),
        );
        if (existing) {
          existing.isBooked = true;
          existing.bookingId = booking._id;
        } else {
          caregiver.availability.push({
            date,
            isBooked: true,
            bookingId: booking._id,
          });
        }
      }
      await caregiver.save();

      // Auto-create DailyReport forms for each date and child
      // Handle both populated document and ObjectId for booking.parent
      const parentId = booking.parent?._id || booking.parent;
      const parent = parentId ? await Parent.findById(parentId) : null;
      const children =
        parent?.children?.length > 0
          ? parent.children
          : [{ childName: booking.customerName }];

      console.log("[Assign] Auto-create reports:", {
        bookingId: booking._id,
        parentId: parentId || "null",
        childrenCount: children.length,
        datesCount: booking.requestedDates.length,
        caregiverId: caregiver._id,
      });

      for (const date of booking.requestedDates) {
        for (const child of children) {
          try {
            const existingReport = await DailyReport.findOne({
              caregiver: caregiver._id,
              booking: booking._id,
              date: date,
              childName: child.childName,
            });

            if (!existingReport) {
              await DailyReport.create({
                caregiver: caregiver._id,
                caregiverName: caregiver.caregiverName,
                parent: parentId || undefined,
                childName: child.childName,
                booking: booking._id,
                date: date,
                status: "draft",
              });
              console.log(
                "[Assign] Created report for",
                child.childName,
                "on",
                date,
              );
            }
          } catch (createErr) {
            console.error(
              "[Assign] DailyReport create error:",
              createErr.message,
            );
          }
        }
      }

      // Update Lead stage
      await Lead.findByIdAndUpdate(booking.lead, { stage: "Active Customer" });

      await createLog(
        req,
        "Assign Booking",
        "Booking",
        booking.bookingNumber,
        `Booking ${booking.bookingNumber} assigned to ${caregiver.caregiverName}`,
      );
      sendSuccess(res, booking, "NA assigned successfully");
    } catch (error) {
      sendError(res, error.message, 400);
    }
  },
);

// Update Booking Status (Complete / Cancel)
app.patch(
  "/api/bookings/:id/status",
  authMiddleware,
  roleMiddleware(["admin", "staff"]),
  async (req, res) => {
    try {
      const { status } = req.body;
      if (!["Completed", "Cancelled"].includes(status)) {
        return sendError(
          res,
          "Invalid status. Must be Completed or Cancelled",
          400,
        );
      }

      const booking = await Booking.findById(req.params.id);
      if (!booking) return sendError(res, "Booking not found", 404);

      booking.status = status;
      await booking.save();

      if (
        (status === "Cancelled" || status === "Completed") &&
        booking.selectedCaregiver
      ) {
        const caregiver = await Caregiver.findById(booking.selectedCaregiver);
        if (caregiver && caregiver.availability) {
          for (const date of booking.requestedDates) {
            const slot = caregiver.availability.find(
              (a) =>
                new Date(a.date).toDateString() ===
                new Date(date).toDateString() &&
                a.bookingId?.toString() === booking._id.toString(),
            );
            if (slot) {
              slot.isBooked = false;
              slot.bookingId = undefined;
            }
          }
          await caregiver.save();
        }
      }

      const label = status === "Completed" ? "completed" : "cancelled";
      await createLog(
        req,
        `${label.charAt(0).toUpperCase() + label.slice(1)} Booking`,
        "Booking",
        booking.bookingNumber,
        `Booking ${booking.bookingNumber} ${label}`,
      );

      if (status === "Completed") {
        await DailyReport.updateMany(
          {
            booking: booking._id,
            status: "draft",
          },
          {
            status: "submitted",
            submittedAt: new Date(),
          }
        );
      }

      sendSuccess(res, booking, `Booking ${label}`);
    } catch (error) {
      sendError(res, error.message, 400);
    }
  },
);

app.post(
  "/api/bookings/:id/generate-invoice",
  authMiddleware,
  roleMiddleware(["admin", "staff"]),
  async (req, res) => {
    try {
      const {
        amount,
        platformFeeRate = 10,
        platformFeeType = "percentage",
      } = req.body;
      const booking = await Booking.findById(req.params.id).populate(
        "selectedCaregiver",
      );
      if (!booking) return sendError(res, "Booking not found", 404);
      if (!["Assigned", "Completed"].includes(booking.status))
        return sendError(
          res,
          "Booking must be Assigned or Completed first",
          400,
        );

      const invoiceNumber = await generateInvoiceNumber();
      const platformFee =
        platformFeeType === "fixed"
          ? platformFeeRate
          : (amount * platformFeeRate) / 100;

      const invoice = new Invoice({
        invoiceNumber,
        customerName: booking.customerName,
        caregiverName: booking.caregiverName || "",
        booking: booking._id,
        parent: null,
        caregiver: booking.selectedCaregiver || null,
        dutyType: booking.dutyType || "Newborn Service",
        servicePackage: booking.servicePackage,
        amount,
        platformFeeType,
        platformFeeRate,
        platformFee,
        date: new Date(),
        serviceStartDate: booking.requestedDates?.[0] || null,
        serviceEndDate:
          booking.requestedDates?.[booking.requestedDates.length - 1] || null,
        additionalCharges: booking.additionalCharges || [],
        invoiceStatus: "Created",
      });
      await invoice.save();

      booking.invoice = invoice._id;
      await booking.save();

      await createLog(
        req,
        "Generate Invoice from Booking",
        "Invoice",
        invoiceNumber,
        `Invoice ${invoiceNumber} generated from Booking ${booking.bookingNumber}`,
      );
      sendSuccess(res, invoice, "Invoice generated", 201);
    } catch (error) {
      sendError(res, error.message, 400);
    }
  },
);

// Public new booking creation (no auth)
app.post("/api/bookings/public/new-booking", async (req, res) => {
  try {
    const {
      parentName,
      contactNumber,
      township,
      address,
      servicePackage,
      dutyDuration,
      dutyShift,
      requestedDates,
      additionalNotes,
      children = []
    } = req.body;

    if (!parentName || !contactNumber) {
      return sendError(res, "Parent Name and Contact Number are required", 400);
    }

    // Find or create Parent
    let parent = await Parent.findOne({ parentName, contactNumber });
    if (!parent) {
      parent = new Parent({
        parentName,
        contactNumber,
        township: township || "",
        address: address || "",
        religion: "Buddhist",
        children: []
      });
    }

    // Add children dynamically if not already added
    if (children && Array.isArray(children)) {
      children.forEach(c => {
        if (c.childName) {
          const hasChild = parent.children.some(
            existingChild => existingChild.childName.toLowerCase() === c.childName.toLowerCase()
          );
          if (!hasChild) {
            parent.children.push({
              childName: c.childName,
              birthDate: c.birthDate ? new Date(c.birthDate) : undefined,
              gender: c.gender || "Male",
              hasInfectiousDisease: !!c.hasInfectiousDisease
            });
          }
        }
      });
    }

    await parent.save();

    // Create Booking
    const bookingNumber = await generateBookingNumber();
    const booking = new Booking({
      bookingNumber,
      customerName: parent.parentName,
      phoneNumber: parent.contactNumber,
      parent: parent._id,
      status: "Pending NA Selection",
      servicePackage: servicePackage || "N/A",
      dutyDuration: dutyDuration || "daily",
      dutyShift: dutyShift || "day",
      requestedDates: requestedDates ? requestedDates.map((d) => new Date(d)) : [],
      additionalNotes: additionalNotes || "",
      bookingToken: generateBookingToken()
    });

    await booking.save();

    await createLog(
      { user: { role: "client", username: "Public Client" } },
      "Public Create Booking",
      "Booking",
      booking.bookingNumber,
      `Booking ${bookingNumber} created from general public link`,
    );

    sendSuccess(res, booking, "Booking submitted successfully", 201);
  } catch (error) {
    sendError(res, error.message, 500);
  }
});

// Public booking form (no auth)
app.get("/api/bookings/public/:token", async (req, res) => {
  try {
    const booking = await Booking.findOne({ bookingToken: req.params.token })
      .populate("parent")
      .populate(
        "suggestedCaregivers.caregiver",
        "caregiverName contactNumber specialization",
      );
    if (!booking) return sendError(res, "Booking not found", 404);
    if (booking.status !== "Pending NA Selection")
      return sendError(res, "Booking is no longer accepting selections", 400);
    sendSuccess(res, booking, "Booking fetched");
  } catch (error) {
    sendError(res, error.message, 500);
  }
});

// Public: Update parent info via booking token (no auth)
app.put("/api/bookings/public/:token/parent", async (req, res) => {
  try {
    const {
      parentName,
      contactNumber,
      township,
      address,
      religion,
      nearestBusStop,
      durationOfBusStopToHome,
    } = req.body;
    const booking = await Booking.findOne({ bookingToken: req.params.token });
    if (!booking) return sendError(res, "Booking not found", 404);

    if (booking.parent) {
      // Update existing parent
      const parent = await Parent.findById(booking.parent);
      if (parent) {
        if (parentName !== undefined) parent.parentName = parentName;
        if (contactNumber !== undefined) parent.contactNumber = contactNumber;
        if (township !== undefined) parent.township = township;
        if (address !== undefined) parent.address = address;
        if (religion !== undefined) parent.religion = religion;
        if (nearestBusStop !== undefined)
          parent.nearestBusStop = nearestBusStop;
        if (durationOfBusStopToHome !== undefined)
          parent.durationOfBusStopToHome = durationOfBusStopToHome;
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
        durationOfBusStopToHome,
      });
      await parent.save();
      booking.parent = parent._id;
      await booking.save();
    }

    const updatedBooking = await Booking.findOne({
      bookingToken: req.params.token,
    })
      .populate("parent")
      .populate(
        "suggestedCaregivers.caregiver",
        "caregiverName contactNumber specialization",
      );

    sendSuccess(res, updatedBooking, "Parent info updated");
  } catch (error) {
    sendError(res, error.message, 400);
  }
});

// Public: Get children (no auth)
app.get("/api/bookings/public/:token/children", async (req, res) => {
  try {
    const booking = await Booking.findOne({
      bookingToken: req.params.token,
    }).populate("parent");
    if (!booking) return sendError(res, "Booking not found", 404);
    if (!booking.parent) return sendSuccess(res, [], "No children yet");
    const parent = await Parent.findById(booking.parent);
    sendSuccess(res, parent.children || [], "Children fetched");
  } catch (error) {
    sendError(res, error.message, 500);
  }
});

// Public: Add child (no auth)
app.post("/api/bookings/public/:token/children", async (req, res) => {
  try {
    const booking = await Booking.findOne({ bookingToken: req.params.token });
    if (!booking) return sendError(res, "Booking not found", 404);

    // Create parent if not exists
    if (!booking.parent) {
      const parent = new Parent({
        parentName: booking.customerName,
        contactNumber: booking.phoneNumber,
      });
      await parent.save();
      booking.parent = parent._id;
      await booking.save();
    }

    const parent = await Parent.findById(booking.parent);
    parent.children.push(req.body);
    await parent.save();
    sendSuccess(res, parent.children, "Child added", 201);
  } catch (error) {
    sendError(res, error.message, 400);
  }
});

// Public: Delete child by index (no auth)
app.delete("/api/bookings/public/:token/children/:index", async (req, res) => {
  try {
    const booking = await Booking.findOne({
      bookingToken: req.params.token,
    }).populate("parent");
    if (!booking) return sendError(res, "Booking not found", 404);
    if (!booking.parent) return sendError(res, "No parent data", 404);

    const parent = await Parent.findById(booking.parent);
    const idx = parseInt(req.params.index);
    if (isNaN(idx) || idx < 0 || idx >= parent.children.length) {
      return sendError(res, "Child not found", 404);
    }
    parent.children.splice(idx, 1);
    await parent.save();
    sendSuccess(res, parent.children, "Child removed");
  } catch (error) {
    sendError(res, error.message, 400);
  }
});

// Public: Update booking details (dutyDuration, dutyShift, etc.) — no auth, idempotent
app.put("/api/bookings/public/:token/details", async (req, res) => {
  try {
    const booking = await Booking.findOne({ bookingToken: req.params.token });
    if (!booking) return sendError(res, "Booking not found", 404);

    const { dutyDuration, dutyShift, requestedDates, additionalNotes } =
      req.body;
    if (dutyDuration !== undefined) booking.dutyDuration = dutyDuration;
    if (dutyShift !== undefined) booking.dutyShift = dutyShift;
    if (requestedDates !== undefined) booking.requestedDates = requestedDates;
    if (additionalNotes !== undefined)
      booking.additionalNotes = additionalNotes;
    await booking.save();

    sendSuccess(res, booking, "Booking details updated");
  } catch (error) {
    sendError(res, error.message, 400);
  }
});

app.post("/api/bookings/public/:token/select", async (req, res) => {
  try {
    const { caregiverId } = req.body;
    const booking = await Booking.findOne({ bookingToken: req.params.token });
    if (!booking) return sendError(res, "Booking not found", 404);
    if (booking.status !== "Pending NA Selection")
      return sendError(res, "Booking is no longer accepting selections", 400);

    const caregiver = await Caregiver.findById(caregiverId);
    if (!caregiver) return sendError(res, "Caregiver not found", 404);

    booking.selectedCaregiver = caregiver._id;
    booking.caregiverName = caregiver.caregiverName;
    booking.status = "Assigned";
    await booking.save();

    sendSuccess(
      res,
      { message: "NA selected successfully", booking },
      "NA selected",
    );
  } catch (error) {
    sendError(res, error.message, 400);
  }
});

app.delete(
  "/api/bookings/:id",
  authMiddleware,
  roleMiddleware(["admin", "staff"]),
  async (req, res) => {
    try {
      const booking = await Booking.findByIdAndDelete(req.params.id);
      if (!booking) return sendError(res, "Booking not found", 404);
      await createLog(
        req,
        "Delete Booking",
        "Booking",
        booking.bookingNumber,
        `Booking ${booking.bookingNumber} deleted`,
      );
      sendSuccess(res, null, "Booking deleted");
    } catch (error) {
      sendError(res, error.message, 500);
    }
  },
);

// --- Schedule Routes ---
app.get(
  "/api/schedule",
  authMiddleware,
  roleMiddleware(["admin", "staff"]),
  async (req, res) => {
    try {
      const bookings = await Booking.find({
        status: { $in: ["Assigned", "Completed", "Pending NA Selection"] },
      })
        .populate("selectedCaregiver", "caregiverName contactNumber")
        .sort({ createdAt: -1 });
      sendSuccess(res, bookings, "Schedule fetched");
    } catch (error) {
      sendError(res, error.message, 500);
    }
  },
);

app.get(
  "/api/caregivers/:id/availability",
  authMiddleware,
  roleMiddleware(["admin", "staff"]),
  async (req, res) => {
    try {
      const caregiver = await Caregiver.findById(req.params.id);
      if (!caregiver) return sendError(res, "Caregiver not found", 404);
      sendSuccess(res, caregiver.availability || [], "Availability fetched");
    } catch (error) {
      sendError(res, error.message, 500);
    }
  },
);

// --- Invoice Lock/Unlock Routes ---
app.patch(
  "/api/invoices/:invoiceNumber/lock",
  authMiddleware,
  roleMiddleware(["admin", "staff"]),
  async (req, res) => {
    try {
      const invoice = await Invoice.findOne({
        invoiceNumber: req.params.invoiceNumber,
      });
      if (!invoice) return sendError(res, "Invoice not found", 404);
      invoice.isLocked = true;
      invoice.invoiceStatus = "Payment Confirmed";
      await invoice.save();
      await createLog(
        req,
        "Lock Invoice",
        "Invoice",
        invoice.invoiceNumber,
        `Invoice ${invoice.invoiceNumber} locked (Payment Confirmed)`,
      );
      sendSuccess(res, invoice, "Invoice locked");
    } catch (error) {
      sendError(res, error.message, 400);
    }
  },
);

app.patch(
  "/api/invoices/:invoiceNumber/unlock",
  authMiddleware,
  roleMiddleware(["admin", "staff"]),
  async (req, res) => {
    try {
      const invoice = await Invoice.findOne({
        invoiceNumber: req.params.invoiceNumber,
      });
      if (!invoice) return sendError(res, "Invoice not found", 404);
      invoice.isLocked = false;
      invoice.invoiceStatus = "Sent";
      await invoice.save();
      await createLog(
        req,
        "Unlock Invoice",
        "Invoice",
        invoice.invoiceNumber,
        `Invoice ${invoice.invoiceNumber} unlocked`,
      );
      sendSuccess(res, invoice, "Invoice unlocked");
    } catch (error) {
      sendError(res, error.message, 400);
    }
  },
);

// --- Payout Summary Route ---
app.get(
  "/api/payouts/summary",
  authMiddleware,
  roleMiddleware(["admin"]),
  async (req, res) => {
    try {
      const invoices = await Invoice.find({ caregiverPayoutStatus: "Paid" })
        .populate("caregiver", "caregiverName contactNumber")
        .sort({ updatedAt: -1 });

      const pending = await Invoice.find({
        caregiverPayoutStatus: "Pending",
        status: { $ne: "Completed" },
      })
        .populate("caregiver", "caregiverName contactNumber")
        .sort({ createdAt: -1 });

      const totalPaid = invoices.reduce((sum, inv) => sum + inv.amount, 0);
      const totalPending = pending.reduce((sum, inv) => sum + inv.amount, 0);

      sendSuccess(
        res,
        { paid: invoices, pending, totalPaid, totalPending },
        "Payout summary fetched",
      );
    } catch (error) {
      sendError(res, error.message, 500);
    }
  },
);

// 1. Create Invoice - BOTH admin and staff
app.post("/api/invoices", authMiddleware, async (req, res) => {
  try {
    const {
      customerName,
      caregiverName,
      dutyType,
      servicePackage,
      amount,
      date,
      serviceStartDate,
      serviceEndDate,
      dueDate,
      parentId,
      caregiverId,
      platformFeeRate = 10,
      platformFeeType = "percentage",
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
    const platformFee =
      platformFeeType === "fixed"
        ? platformFeeRate
        : (amount * platformFeeRate) / 100;

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
      dueDate,
    });
    await invoice.save();

    const logDetails = `Invoice ${invoice.invoiceNumber} created for ${resolvedName}. Date: ${date}${dueDate ? `, Due: ${dueDate}` : ""}`;
    await createLog(
      req,
      "Create Invoice",
      "Invoice",
      invoice.invoiceNumber,
      logDetails,
    );

    sendSuccess(res, invoice, "Invoice created", 201);
  } catch (error) {
    sendError(res, error.message, 400);
  }
});

// --- Parent Routes ---
app.post(
  "/api/parents",
  authMiddleware,
  roleMiddleware(["admin", "staff"]),
  async (req, res) => {
    try {
      const parent = new Parent(req.body);
      await parent.save();

      await createLog(
        req,
        "Create Parent",
        "Parent",
        parent._id.toString(),
        `Parent ${parent.parentName} created`,
      );

      sendSuccess(res, parent, "Parent created", 201);
    } catch (error) {
      sendError(res, error.message, 400);
    }
  },
);

app.post(
  "/api/parents/import",
  authMiddleware,
  roleMiddleware(["admin", "staff"]),
  async (req, res) => {
    try {
      const { parents } = req.body;
      if (!parents || !Array.isArray(parents)) {
        return sendError(res, "Invalid parents list data format", 400);
      }

      const imported = [];
      const errors = [];

      for (let i = 0; i < parents.length; i++) {
        const item = parents[i];
        if (!item.parentName) {
          errors.push({ index: i, error: "Parent Name is required" });
          continue;
        }

        try {
          // Check for duplicate parent
          let existing = null;
          if (item.contactNumber) {
            existing = await Parent.findOne({
              parentName: item.parentName,
              contactNumber: item.contactNumber,
            });
          }

          if (existing) {
            errors.push({ index: i, error: `Parent "${item.parentName}" with this contact number already exists` });
            continue;
          }

          const newParent = new Parent({
            parentName: item.parentName,
            contactNumber: item.contactNumber || "",
            township: item.township || "",
            address: item.address || "",
            religion: item.religion || "Buddhist",
            nearestBusStop: item.nearestBusStop || "",
            durationOfBusStopToHome: item.durationOfBusStopToHome || "",
            status: item.status || "Inactive",
            profession: item.profession || "",
            children: item.children || [],
          });

          await newParent.save();

          await createLog(
            req,
            "Import Parent",
            "Parent",
            newParent._id.toString(),
            `Parent ${newParent.parentName} imported via Excel`,
          );

          imported.push(newParent);
        } catch (err) {
          errors.push({ index: i, error: err.message });
        }
      }

      sendSuccess(res, { importedCount: imported.length, errors }, `Imported ${imported.length} parents with ${errors.length} errors.`);
    } catch (error) {
      sendError(res, error.message, 500);
    }
  },
);

app.get(
  "/api/parents",
  authMiddleware,
  roleMiddleware(["admin", "staff"]),
  async (req, res) => {
    try {
      const parents = await Parent.find().sort({ parentName: 1 });
      sendSuccess(res, parents, "Parents fetched");
    } catch (error) {
      sendError(res, error.message, 500);
    }
  },
);

app.get(
  "/api/parents/:id",
  authMiddleware,
  roleMiddleware(["admin", "staff"]),
  async (req, res) => {
    try {
      const parent = await Parent.findById(req.params.id);
      if (!parent) return sendError(res, "Parent not found", 404);
      sendSuccess(res, parent, "Parent fetched");
    } catch (error) {
      sendError(res, error.message, 500);
    }
  },
);

app.get(
  "/api/parents/:id/bookings",
  authMiddleware,
  roleMiddleware(["admin", "staff"]),
  async (req, res) => {
    try {
      const bookings = await Booking.find({ parent: req.params.id })
        .populate("selectedCaregiver", "caregiverName contactNumber")
        .sort({ createdAt: -1 });
      sendSuccess(res, bookings, "Parent bookings fetched");
    } catch (error) {
      sendError(res, error.message, 500);
    }
  },
);

app.put(
  "/api/parents/:id",
  authMiddleware,
  roleMiddleware(["admin", "staff"]),
  async (req, res) => {
    try {
      const parent = await Parent.findByIdAndUpdate(req.params.id, req.body, {
        new: true,
        runValidators: true,
      });
      if (!parent) return sendError(res, "Parent not found", 404);

      await createLog(
        req,
        "Update Parent",
        "Parent",
        parent._id.toString(),
        `Parent ${parent.parentName} updated`,
      );

      sendSuccess(res, parent, "Parent updated");
    } catch (error) {
      sendError(res, error.message, 400);
    }
  },
);

// --- Caregiver Routes ---
app.post(
  "/api/caregivers",
  authMiddleware,
  roleMiddleware(["admin", "staff"]),
  async (req, res) => {
    try {
      const { caregiverName, NRC, ...otherData } = req.body;

      // Auto-generate username from name
      const username = await generateUsername(caregiverName);

      // Extract password from NRC digits (e.g., "12/lamana(P)001233" → "001233")
      const password = extractPassword(NRC);

      const caregiver = new Caregiver({
        caregiverName,
        NRC,
        username,
        password,
        ...otherData,
      });
      await caregiver.save();

      await createLog(
        req,
        "Create Caregiver",
        "Caregiver",
        caregiver._id.toString(),
        `Caregiver ${caregiver.caregiverName} created`,
      );

      sendSuccess(
        res,
        {
          ...caregiver.toObject(),
          temporaryPassword: password,
        },
        "Caregiver created",
        201,
      );
    } catch (e) {
      sendError(res, e.message, 400);
    }
  },
);

app.get(
  "/api/caregivers",
  authMiddleware,
  roleMiddleware(["admin", "staff"]),
  async (req, res) => {
    try {
      const caregivers = await Caregiver.find().sort({ caregiverName: 1 });
      sendSuccess(res, caregivers, "Caregivers fetched");
    } catch (e) {
      sendError(res, e.message, 500);
    }
  },
);

app.get(
  "/api/caregivers/:id",
  authMiddleware,
  roleMiddleware(["admin", "staff"]),
  async (req, res) => {
    try {
      const caregiver = await Caregiver.findById(req.params.id);
      if (!caregiver) return sendError(res, "Caregiver not found", 404);
      sendSuccess(res, caregiver, "Caregiver fetched");
    } catch (error) {
      sendError(res, error.message, 500);
    }
  },
);

app.put(
  "/api/caregivers/:id",
  authMiddleware,
  roleMiddleware(["admin", "staff"]),
  async (req, res) => {
    try {
      const { caregiverName, NRC, ...otherData } = req.body;

      const existingCaregiver = await Caregiver.findById(req.params.id);
      if (!existingCaregiver) return sendError(res, "Caregiver not found", 404);

      // Update username if name changed
      let username = existingCaregiver.username;
      if (caregiverName && caregiverName !== existingCaregiver.caregiverName) {
        username = await generateUsername(caregiverName);
      }

      // Note: Password is NOT updated when NRC changes
      // Password can only be changed via NA's own password change endpoint

      // Update other fields
      Object.assign(existingCaregiver, {
        caregiverName: caregiverName || existingCaregiver.caregiverName,
        NRC: NRC || existingCaregiver.NRC,
        username,
        ...otherData,
      });

      await existingCaregiver.save();

      await createLog(
        req,
        "Update Caregiver",
        "Caregiver",
        existingCaregiver._id.toString(),
        `Caregiver ${existingCaregiver.caregiverName} updated`,
      );

      sendSuccess(res, existingCaregiver, "Caregiver updated");
    } catch (error) {
      sendError(res, error.message, 400);
    }
  },
);

// Caregiver Stats
app.get(
  "/api/caregivers/:id/stats",
  authMiddleware,
  roleMiddleware(["admin", "staff"]),
  async (req, res) => {
    try {
      const caregiver = await Caregiver.findById(req.params.id);
      if (!caregiver) return sendError(res, "Caregiver not found", 404);

      const invoices = await Invoice.find({ caregiver: req.params.id }).sort({
        createdAt: -1,
      });
      const invoiceIds = invoices.map((inv) => inv._id);
      const payouts = await CaregiverPayout.find({
        invoiceId: { $in: invoiceIds },
      });

      const totalPaid = payouts.reduce((sum, p) => sum + (p.amount || 0), 0);
      const totalPending = invoices
        .filter((inv) => inv.caregiverPayoutStatus === "Pending")
        .reduce((sum, inv) => sum + (inv.amount - (inv.platformFee || 0)), 0);

      const bookingIds = invoices.map((inv) => inv.booking).filter(Boolean);
      const bookings = await Booking.find({ _id: { $in: bookingIds } })
        .populate("parent", "parentName contactNumber")
        .sort({ createdAt: -1 });

      sendSuccess(
        res,
        {
          caregiver,
          bookings,
          totalPaid,
          totalPending,
          invoiceCount: invoices.length,
          bookingCount: bookings.length,
        },
        "Caregiver stats fetched",
      );
    } catch (error) {
      sendError(res, error.message, 500);
    }
  },
);

// 2. Get All Invoices - ONLY admin
app.get(
  "/api/invoices",
  authMiddleware,
  roleMiddleware(["admin", "staff"]),
  async (req, res) => {
    try {
      const {
        status,
        customerPaymentStatus,
        caregiverPayoutStatus,
        startDate,
        endDate,
      } = req.query;
      const query = {};
      if (status) query.status = status;
      if (customerPaymentStatus)
        query.customerPaymentStatus = customerPaymentStatus;
      if (caregiverPayoutStatus)
        query.caregiverPayoutStatus = caregiverPayoutStatus;

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
      sendSuccess(res, invoices, "Invoices fetched");
    } catch (error) {
      sendError(res, error.message, 500);
    }
  },
);

// 3. Get Invoice by Number - BOTH admin and staff
app.get("/api/invoices/:invoiceNumber", authMiddleware, async (req, res) => {
  try {
    const invoice = await Invoice.findOne({
      invoiceNumber: req.params.invoiceNumber,
    }).lean();
    if (!invoice) return sendError(res, "Invoice not found", 404);

    const payment = await CustomerPayment.findOne({
      invoiceId: invoice._id,
    }).sort({ createdAt: -1 });
    const payout = await CaregiverPayout.findOne({
      invoiceId: invoice._id,
    }).sort({ createdAt: -1 });

    sendSuccess(
      res,
      {
        ...invoice,
        paymentDetails: payment,
        payoutDetails: payout,
      },
      "Invoice fetched",
    );
  } catch (error) {
    sendError(res, error.message, 500);
  }
});
// 4. Update Customer Payment - ONLY admin
app.post(
  "/api/invoices/:invoiceNumber/payments",
  authMiddleware,
  roleMiddleware(["admin", "staff"]),
  async (req, res) => {
    try {
      const invoice = await Invoice.findOne({
        invoiceNumber: req.params.invoiceNumber,
      });
      if (!invoice) return sendError(res, "Invoice not found", 404);

      const {
        receivedAmount,
        paymentChannel,
        payerAccountName,
        dateTime,
        note,
      } = req.body;

      const payment = new CustomerPayment({
        invoiceId: invoice._id,
        receivedAmount,
        paymentChannel,
        payerAccountName,
        dateTime,
        note,
      });
      await payment.save();

      invoice.customerPaymentStatus = "Received";
      // Sync the invoice's paymentMethod with the channel used for the payment
      if (paymentChannel) {
        invoice.paymentMethod = paymentChannel;
      }

      await invoice.save();
      await checkAndUpdateInvoiceCompletion(invoice._id);

      // Log payment update
      await createLog(
        req,
        "Update Payment",
        "Invoice",
        invoice.invoiceNumber,
        `Payment of ${receivedAmount} received for invoice ${invoice.invoiceNumber}`,
      );

      sendSuccess(res, { payment, invoice }, "Payment recorded", 201);
    } catch (error) {
      sendError(res, error.message, 400);
    }
  },
);

// 5. Update Caregiver Payout - ONLY admin
app.post(
  "/api/invoices/:invoiceNumber/payouts",
  authMiddleware,
  roleMiddleware(["admin", "staff"]),
  async (req, res) => {
    try {
      const invoice = await Invoice.findOne({
        invoiceNumber: req.params.invoiceNumber,
      });
      if (!invoice) return sendError(res, "Invoice not found", 404);

      const {
        paymentChannel,
        payeeAccountName,
        dateTime,
        note,
        amount,
        secondName,
        dutyType,
      } = req.body;

      const payout = new CaregiverPayout({
        invoiceId: invoice._id,
        paymentChannel,
        payeeAccountName,
        amount: amount || invoice.amount,
        secondName,
        dutyType: dutyType || invoice.dutyType,
        dateTime,
        note,
      });
      await payout.save();

      invoice.caregiverPayoutStatus = "Paid";
      await invoice.save();
      await checkAndUpdateInvoiceCompletion(invoice._id);

      const updatedInvoice = await Invoice.findById(invoice._id);

      // Log payout update
      await createLog(
        req,
        "Update Payout",
        "Invoice",
        invoice.invoiceNumber,
        `Payout recorded for invoice ${invoice.invoiceNumber}`,
      );

      sendSuccess(
        res,
        { payout, invoice: updatedInvoice },
        "Payout recorded",
        201,
      );
    } catch (error) {
      sendError(res, error.message, 400);
    }
  },
);

// 6. Update Invoice Data - ONLY admin
app.put(
  "/api/invoices/:invoiceNumber",
  authMiddleware,
  roleMiddleware(["admin", "staff"]),
  async (req, res) => {
    try {
      const invoice = await Invoice.findOne({
        invoiceNumber: req.params.invoiceNumber,
      });
      if (!invoice) return res.status(404).json({ error: "Invoice not found" });

      const {
        customerName,
        caregiverName,
        amount,
        dutyType,
        servicePackage,
        date,
        serviceStartDate,
        serviceEndDate,
        dueDate,
        paymentMethod,
        parentId,
        caregiverId,
        platformFeeRate,
        platformFeeType,
      } = req.body;

      if (customerName !== undefined) invoice.customerName = customerName;
      if (caregiverName !== undefined) invoice.caregiverName = caregiverName;

      // Lock amount when payment is confirmed
      if (
        invoice.customerPaymentStatus === "Received" &&
        amount !== undefined &&
        amount !== invoice.amount
      ) {
        return sendError(
          res,
          "Cannot edit amount after payment is confirmed",
          400,
        );
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
      if (serviceStartDate !== undefined)
        invoice.serviceStartDate = serviceStartDate;
      if (serviceEndDate !== undefined) invoice.serviceEndDate = serviceEndDate;
      if (dueDate !== undefined) invoice.dueDate = dueDate;
      if (paymentMethod !== undefined) invoice.paymentMethod = paymentMethod;
      if (platformFeeType !== undefined)
        invoice.platformFeeType = platformFeeType;
      if (platformFeeRate !== undefined)
        invoice.platformFeeRate = platformFeeRate;

      // Recalculate platformFee if amount, platformFeeRate, or platformFeeType was updated
      if (
        amount !== undefined ||
        platformFeeRate !== undefined ||
        platformFeeType !== undefined
      ) {
        invoice.platformFee =
          invoice.platformFeeType === "fixed"
            ? invoice.platformFeeRate
            : (invoice.amount * invoice.platformFeeRate) / 100;
      }

      await invoice.save();

      // Log invoice update
      await createLog(
        req,
        "Update Invoice",
        "Invoice",
        invoice.invoiceNumber,
        `Invoice ${invoice.invoiceNumber} details updated`,
      );

      sendSuccess(res, invoice, "Invoice updated");
    } catch (error) {
      sendError(res, error.message, 400);
    }
  },
);

// 7. Update Invoice Status Directly - ONLY admin
app.patch(
  "/api/invoices/:invoiceNumber/status",
  authMiddleware,
  roleMiddleware(["admin", "staff"]),
  async (req, res) => {
    try {
      const { customerPaymentStatus, caregiverPayoutStatus } = req.body;
      const invoice = await Invoice.findOne({
        invoiceNumber: req.params.invoiceNumber,
      });
      if (!invoice) return sendError(res, "Invoice not found", 404);

      if (customerPaymentStatus)
        invoice.customerPaymentStatus = customerPaymentStatus;
      if (caregiverPayoutStatus)
        invoice.caregiverPayoutStatus = caregiverPayoutStatus;

      // Recalculate overall status
      if (
        invoice.customerPaymentStatus === "Received" &&
        invoice.caregiverPayoutStatus === "Paid"
      ) {
        invoice.status = "Completed";
      } else {
        invoice.status = "Pending";
      }

      await invoice.save();

      // Log status toggle
      await createLog(
        req,
        "Update Status",
        "Invoice",
        invoice.invoiceNumber,
        `Status updated for invoice ${invoice.invoiceNumber} (Payment: ${invoice.customerPaymentStatus}, Payout: ${invoice.caregiverPayoutStatus})`,
      );

      sendSuccess(res, invoice, "Status updated");
    } catch (error) {
      sendError(res, error.message, 400);
    }
  },
);

// 8. Delete Invoice - ONLY admin
app.delete(
  "/api/invoices/:invoiceNumber",
  authMiddleware,
  roleMiddleware(["admin", "staff"]),
  async (req, res) => {
    try {
      const invoice = await Invoice.findOneAndDelete({
        invoiceNumber: req.params.invoiceNumber,
      });
      if (!invoice) return sendError(res, "Invoice not found", 404);

      // Also cleanup associated records
      await CustomerPayment.deleteMany({ invoiceId: invoice._id });
      await CaregiverPayout.deleteMany({ invoiceId: invoice._id });

      // Log invoice deletion
      await createLog(
        req,
        "Delete Invoice",
        "Invoice",
        invoice.invoiceNumber,
        `Invoice ${invoice.invoiceNumber} deleted`,
      );

      sendSuccess(res, null, "Invoice and associated records deleted");
    } catch (error) {
      sendError(res, error.message, 500);
    }
  },
);

// 8.5 Expenses - ONLY admin
app.get(
  "/api/expenses",
  authMiddleware,
  roleMiddleware(["admin"]),
  async (req, res) => {
    try {
      const { startDate, endDate, category } = req.query;
      const query = {};
      if (startDate || endDate) {
        query.dateTime = {};
        if (startDate) query.dateTime.$gte = new Date(startDate);
        if (endDate) {
          const end = new Date(endDate);
          end.setHours(23, 59, 59, 999);
          query.dateTime.$lte = end;
        }
      }
      if (category) query.category = category;

      const expenses = await Expense.find(query).sort({ dateTime: -1 });
      sendSuccess(res, expenses, "Expenses fetched");
    } catch (error) {
      sendError(res, error.message, 500);
    }
  },
);

app.post(
  "/api/expenses",
  authMiddleware,
  roleMiddleware(["admin"]),
  async (req, res) => {
    try {
      const { category, amount, paymentChannel, description, dateTime, note } =
        req.body;
      if (!category || !amount)
        return sendError(res, "Category and amount are required", 400);

      const expense = await Expense.create({
        category,
        amount: Number(amount),
        paymentChannel: paymentChannel || "Cash",
        description,
        dateTime: dateTime || new Date(),
        note,
      });
      sendSuccess(res, expense, "Expense created", 201);
    } catch (error) {
      sendError(res, error.message, 500);
    }
  },
);

app.put(
  "/api/expenses/:id",
  authMiddleware,
  roleMiddleware(["admin"]),
  async (req, res) => {
    try {
      const { category, amount, paymentChannel, description, dateTime, note } =
        req.body;
      const expense = await Expense.findByIdAndUpdate(
        req.params.id,
        {
          category,
          amount: amount !== undefined ? Number(amount) : undefined,
          paymentChannel,
          description,
          dateTime,
          note,
        },
        { new: true, runValidators: true },
      );
      if (!expense) return sendError(res, "Expense not found", 404);
      sendSuccess(res, expense, "Expense updated");
    } catch (error) {
      sendError(res, error.message, 500);
    }
  },
);

app.delete(
  "/api/expenses/:id",
  authMiddleware,
  roleMiddleware(["admin"]),
  async (req, res) => {
    try {
      const expense = await Expense.findByIdAndDelete(req.params.id);
      if (!expense) return sendError(res, "Expense not found", 404);
      sendSuccess(res, expense, "Expense deleted");
    } catch (error) {
      sendError(res, error.message, 500);
    }
  },
);

// 9. Dashboard Stats - ONLY admin
app.get(
  "/api/stats",
  authMiddleware,
  roleMiddleware(["admin"]),
  async (req, res) => {
    try {
      const { startDate, endDate } = req.query;

      const invoiceFilter = {};
      const leadFilter = {};
      const bookingFilter = {};
      const expenseFilter = {};

      if (startDate || endDate) {
        const dateQuery = {};
        if (startDate) dateQuery.$gte = new Date(startDate);
        if (endDate) {
          const end = new Date(endDate);
          end.setHours(23, 59, 59, 999);
          dateQuery.$lte = end;
        }

        invoiceFilter.date = dateQuery;
        leadFilter.createdAt = dateQuery;
        bookingFilter.createdAt = dateQuery;
        expenseFilter.dateTime = dateQuery;
      }

      const invoices = await Invoice.find(invoiceFilter);
      const leads = await Lead.find(leadFilter);
      const bookings = await Booking.find(bookingFilter);
      const expenses = await Expense.find(expenseFilter);

      const stats = {
        totalInvoices: invoices.length,
        totalRevenue: invoices.reduce(
          (sum, inv) => sum + inv.amount + (inv.platformFee || 0),
          0,
        ),
        totalPayouts: invoices.reduce((sum, inv) => sum + inv.amount, 0),
        totalPlatformFee: invoices.reduce(
          (sum, inv) => sum + (inv.platformFee || 0),
          0,
        ),
        totalExpenses: expenses.reduce((sum, e) => sum + (e.amount || 0), 0),
        totalProfit:
          invoices.reduce(
            (sum, inv) => sum + (inv.platformFee || 0),
            0,
          ) -
          expenses.reduce((sum, e) => sum + (e.amount || 0), 0),
        pendingPayments: invoices
          .filter((i) => i.customerPaymentStatus === "Pending")
          .reduce((sum, inv) => sum + inv.amount + (inv.platformFee || 0), 0),
        accountsReceivable: invoices
          .filter(
            (i) =>
              i.customerPaymentStatus === "Pending" ||
              i.invoiceStatus === "Sent",
          )
          .reduce((sum, inv) => sum + inv.amount + (inv.platformFee || 0), 0),
        pendingPayouts: invoices
          .filter((i) => i.caregiverPayoutStatus === "Pending")
          .reduce((sum, inv) => sum + inv.amount, 0),
        completedInvoices: invoices.filter((i) => i.status === "Completed")
          .length,
        // Lead stats
        totalLeads: leads.length,
        newLeads: leads.filter((l) => l.stage === "New").length,
        contactedLeads: leads.filter((l) => l.stage === "Contacted").length,
        saleClosedLeads: leads.filter((l) => l.stage === "Sale Closed").length,
        activeCustomers: leads.filter((l) => l.stage === "Active Customer")
          .length,
        lostLeads: leads.filter((l) => l.stage === "Lost").length,
        // Booking stats
        totalBookings: bookings.length,
        pendingBookings: bookings.filter(
          (b) => b.status === "Pending NA Selection",
        ).length,
        assignedBookings: bookings.filter((b) => b.status === "Assigned")
          .length,
        completedBookings: bookings.filter((b) => b.status === "Completed")
          .length,
        activeNAs: new Set(
          bookings
            .filter((b) => b.status === "Assigned" && b.selectedCaregiver)
            .map((b) => b.selectedCaregiver.toString()),
        ).size,
        // Invoice status stats
        draftInvoices: invoices.filter((i) => i.invoiceStatus === "Draft")
          .length,
        createdInvoices: invoices.filter((i) => i.invoiceStatus === "Created")
          .length,
        sentInvoices: invoices.filter((i) => i.invoiceStatus === "Sent").length,
        confirmedInvoices: invoices.filter(
          (i) => i.invoiceStatus === "Payment Confirmed",
        ).length,
      };

      sendSuccess(res, stats, "Stats fetched");
    } catch (error) {
      sendError(res, error.message, 500);
    }
  },
);

// 10. Financial Report - ONLY admin
app.get(
  "/api/reports/financial",
  authMiddleware,
  roleMiddleware(["admin"]),
  async (req, res) => {
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

      const payments = await CustomerPayment.find(dateQuery).sort({
        createdAt: -1,
      });
      const payouts = await CaregiverPayout.find(dateQuery).sort({
        createdAt: -1,
      });
      const invoices = await Invoice.find(dateQuery).sort({ createdAt: -1 });

      // Expenses are dated by their own dateTime (not createdAt), so build a
      // separate range query against that field.
      const expenseDateQuery = {};
      if (startDate || endDate) {
        expenseDateQuery.dateTime = {};
        if (startDate) expenseDateQuery.dateTime.$gte = new Date(startDate);
        if (endDate) {
          const end = new Date(endDate);
          end.setHours(23, 59, 59, 999);
          expenseDateQuery.dateTime.$lte = end;
        }
      }
      const expenses = await Expense.find(expenseDateQuery).sort({
        dateTime: -1,
      });

      const channelBreakdown = {};
      const channels = ["KBZPay (Kpay)", "AYAPay", "WavePay"];

      channels.forEach((ch) => {
        channelBreakdown[ch] = { income: 0, payouts: 0, fees: 0, count: 0 };
      });

      let totalIncome = 0;
      let totalPayouts = 0;
      let totalFees = 0;
      let totalExpenses = 0;

      payments.forEach((p) => {
        const ch = p.paymentChannel || "KBZPay (Kpay)";
        if (!channelBreakdown[ch])
          channelBreakdown[ch] = { income: 0, payouts: 0, fees: 0, count: 0 };
        channelBreakdown[ch].income += p.receivedAmount || 0;
        channelBreakdown[ch].count += 1;
        totalIncome += p.receivedAmount || 0;
      });

      payouts.forEach((p) => {
        const ch = p.paymentChannel || "KBZPay (Kpay)";
        if (!channelBreakdown[ch])
          channelBreakdown[ch] = { income: 0, payouts: 0, fees: 0, count: 0 };
        channelBreakdown[ch].payouts += p.amount || 0;
        totalPayouts += p.amount || 0;
      });

      invoices.forEach((inv) => {
        totalFees += inv.platformFee || 0;
      });

      expenses.forEach((e) => {
        totalExpenses += e.amount || 0;
      });

      const dailyData = {};
      payments.forEach((p) => {
        const day = new Date(p.createdAt).toISOString().split("T")[0];
        if (!dailyData[day])
          dailyData[day] = { income: 0, payouts: 0, fees: 0 };
        dailyData[day].income += p.receivedAmount || 0;
      });
      payouts.forEach((p) => {
        const day = new Date(p.createdAt).toISOString().split("T")[0];
        if (!dailyData[day])
          dailyData[day] = { income: 0, payouts: 0, fees: 0 };
        dailyData[day].payouts += p.amount || 0;
      });
      invoices.forEach((inv) => {
        const day = new Date(inv.createdAt).toISOString().split("T")[0];
        if (!dailyData[day])
          dailyData[day] = { income: 0, payouts: 0, fees: 0 };
        dailyData[day].fees += inv.platformFee || 0;
      });
      expenses.forEach((e) => {
        const day = new Date(e.dateTime).toISOString().split("T")[0];
        if (!dailyData[day])
          dailyData[day] = { income: 0, payouts: 0, fees: 0, expense: 0 };
        dailyData[day].expense = (dailyData[day].expense || 0) + (e.amount || 0);
      });

      sendSuccess(
        res,
        {
          totalIncome,
          totalPayouts,
          totalFees,
          totalExpenses,
          netProfit: totalIncome - totalPayouts - totalExpenses,
          channelBreakdown,
          dailyData,
          paymentCount: payments.length,
          payoutCount: payouts.length,
          expenseCount: expenses.length,
        },
        "Financial report fetched",
      );
    } catch (error) {
      sendError(res, error.message, 500);
    }
  },
);

// 11. Get Logs - ONLY admin
app.get(
  "/api/logs",
  authMiddleware,
  roleMiddleware(["admin"]),
  async (req, res) => {
    try {
      const logs = await Log.find().sort({ timestamp: -1 }).limit(500);
      sendSuccess(res, logs, "Logs fetched");
    } catch (error) {
      sendError(res, error.message, 500);
    }
  },
);

// --- Parent Routes Delete ---
app.delete(
  "/api/parents/:id",
  authMiddleware,
  roleMiddleware(["admin", "staff"]),
  async (req, res) => {
    try {
      const parentId = req.params.id;
      await Parent.findByIdAndDelete(parentId);

      // Set parent reference to null in all associated invoices
      const updateResult = await Invoice.updateMany(
        { parent: parentId },
        { $set: { parent: null } },
      );

      console.log(
        `>>> DELETED Parent ${parentId}. Updated ${updateResult.modifiedCount} invoices.`,
      );

      await createLog(
        req,
        "Delete Parent",
        "Parent",
        parentId,
        `Parent ${parentId} deleted`,
      );

      sendSuccess(res, null, "Parent deleted and invoices updated");
    } catch (error) {
      console.error(">>> DELETE PARENT ERROR:", error);
      sendError(res, error.message, 500);
    }
  },
);

// --- Caregiver Routes Delete ---
app.delete(
  "/api/caregivers/:id",
  authMiddleware,
  roleMiddleware(["admin", "staff"]),
  async (req, res) => {
    try {
      const caregiverId = req.params.id;
      await Caregiver.findByIdAndDelete(caregiverId);

      // Set caregiver reference to null in all associated invoices
      const updateResult = await Invoice.updateMany(
        { caregiver: caregiverId },
        { $set: { caregiver: null } },
      );

      console.log(
        `>>> DELETED Caregiver ${caregiverId}. Updated ${updateResult.modifiedCount} invoices.`,
      );

      // Log caregiver deletion
      await createLog(
        req,
        "Delete Caregiver",
        "Caregiver",
        caregiverId,
        `Caregiver ${caregiverId} deleted`,
      );

      sendSuccess(res, null, "Caregiver deleted and invoices updated");
    } catch (error) {
      console.error(">>> DELETE CAREGIVER ERROR:", error);
      sendError(res, error.message, 500);
    }
  },
);

// --- NA Auth Routes ---
app.post("/api/na/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return sendError(res, "Username and password are required");
    }

    const caregiver = await Caregiver.findOne({
      username: username.toLowerCase(),
    });
    if (!caregiver || !(await caregiver.comparePassword(password))) {
      return sendError(res, "Invalid credentials", 401);
    }

    const token = jwt.sign(
      { id: caregiver._id, type: "na" },
      process.env.JWT_SECRET,
      { expiresIn: "7d" },
    );

    sendSuccess(
      res,
      {
        token,
        caregiver: {
          id: caregiver._id,
          username: caregiver.username,
          name: caregiver.caregiverName,
        },
      },
      "Login successful",
    );
  } catch (err) {
    sendError(res, err.message, 400);
  }
});

app.get("/api/na/auth/me", naAuthMiddleware, (req, res) => {
  sendSuccess(res, {
    caregiver: {
      id: req.caregiver._id,
      username: req.caregiver.username,
      name: req.caregiver.caregiverName,
    },
  });
});

app.put("/api/na/auth/change-password", naAuthMiddleware, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const caregiver = req.caregiver;

    // Verify current password
    const isMatch = await caregiver.comparePassword(currentPassword);
    if (!isMatch) {
      return sendError(res, "လက်ရှိ password မမှန်ကန်ပါ");
    }

    // Set new password
    caregiver.password = newPassword;
    await caregiver.save();

    sendSuccess(res, null, "Password ပြောင်းပြီးပါပြီ");
  } catch (err) {
    sendError(res, err.message, 400);
  }
});

// --- NA Duty Routes ---
app.post("/api/na/duty/start", naAuthMiddleware, async (req, res) => {
  try {
    const { bookingId } = req.body;
    const caregiver = req.caregiver;

    // Check for active duty
    const activeDuty = await DutyLog.findOne({
      caregiver: caregiver._id,
      status: "active",
    });
    if (activeDuty) {
      return sendError(
        res,
        "You already have an active duty. Finish it first.",
      );
    }

    // Get booking details
    const booking = await Booking.findById(bookingId);
    if (!booking) {
      return sendError(res, "Booking not found");
    }

    // Verify that this booking is indeed assigned to this caregiver
    if (!booking.selectedCaregiver || booking.selectedCaregiver.toString() !== caregiver._id.toString()) {
      return sendError(res, "This booking is not assigned to you");
    }

    const dutyLog = new DutyLog({
      caregiver: caregiver._id,
      caregiverName: caregiver.caregiverName,
      booking: booking._id,
      parent: booking.parent,
      childName: booking.childName,
      date: new Date(),
      dutyStart: new Date(),
      status: "active",
    });
    await dutyLog.save();

    sendSuccess(res, dutyLog, "Duty started", 201);
  } catch (err) {
    sendError(res, err.message, 400);
  }
});

app.post("/api/na/duty/finish", naAuthMiddleware, async (req, res) => {
  try {
    const { dutyLogId } = req.body;
    const caregiver = req.caregiver;

    const dutyLog = await DutyLog.findOne({
      _id: dutyLogId,
      caregiver: caregiver._id,
      status: "active",
    });
    if (!dutyLog) {
      return sendError(res, "Active duty log not found");
    }

    dutyLog.dutyEnd = new Date();
    dutyLog.status = "completed";
    await dutyLog.save();

    // Update Booking status to Completed
    // Weekly/Monthly fix — multi-date (သို့) dutyDuration=weekly/monthly booking ဆိုရင်
    // နောက်ဆုံး service ရက်မှာပဲ Complete လုပ်တယ်၊ မဟုတ်ရင် Assigned အဖြစ် ဆက်ထားတယ်
    const booking = await Booking.findById(dutyLog.booking);
    if (booking && booking.status !== "Completed") {
      const serviceDates = (booking.requestedDates || [])
        .filter(Boolean)
        .map((d) => {
          const dt = new Date(d);
          dt.setHours(23, 59, 59, 999);
          return dt.getTime();
        });
      const todayEnd = new Date();
      todayEnd.setHours(23, 59, 59, 999);

      const durationStr = (booking.dutyDuration || "").toLowerCase();
      const isOngoingPackage =
        serviceDates.length <= 1 &&
        (durationStr.includes("week") || durationStr.includes("month"));

      const hasUpcomingService =
        serviceDates.some((ts) => ts > todayEnd.getTime()) || isOngoingPackage;

      if (!hasUpcomingService) {
        booking.status = "Completed";
        await booking.save();

        // Free caregiver availability slots
        if (booking.selectedCaregiver) {
          const cg = await Caregiver.findById(booking.selectedCaregiver);
          if (cg && cg.availability) {
            for (const date of booking.requestedDates) {
              const slot = cg.availability.find(
                (a) =>
                  new Date(a.date).toDateString() ===
                  new Date(date).toDateString() &&
                  a.bookingId?.toString() === booking._id.toString()
              );
              if (slot) {
                slot.isBooked = false;
                slot.bookingId = undefined;
              }
            }
            await cg.save();
          }
        }
      }
    }

    // Also auto-submit draft DailyReports for this caregiver and booking
    // Weekly fix — date <= now ပဲ submit လုပ်တယ် (နောက်ရက်တွေရဲ့ ကြိုဆောက်ထားတဲ့
    // draft form တွေ submitted မဖြစ်စေဖို့၊ ဆက်ရေးနိုင်ရန်)
    await DailyReport.updateMany(
      {
        caregiver: caregiver._id,
        booking: dutyLog.booking,
        status: "draft",
        date: { $lte: new Date() },
      },
      {
        status: "submitted",
        submittedAt: new Date(),
      }
    );

    sendSuccess(res, dutyLog, "Duty finished");
  } catch (err) {
    sendError(res, err.message, 400);
  }
});

app.get("/api/na/duty/status", naAuthMiddleware, async (req, res) => {
  try {
    const caregiver = req.caregiver;
    const activeDuty = await DutyLog.findOne({
      caregiver: caregiver._id,
      status: "active",
    }).populate("booking");

    sendSuccess(res, { activeDuty });
  } catch (err) {
    sendError(res, err.message, 400);
  }
});

app.get("/api/na/duty/logs", naAuthMiddleware, async (req, res) => {
  try {
    const caregiver = req.caregiver;
    const { date, bookingId } = req.query;
    const filter = { caregiver: caregiver._id };
    if (date) {
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);
      filter.date = { $gte: startOfDay, $lte: endOfDay };
    }
    if (bookingId) {
      filter.booking = bookingId;
    }

    const logs = await DutyLog.find(filter).sort({ dutyStart: -1 });
    sendSuccess(res, logs);
  } catch (err) {
    sendError(res, err.message, 400);
  }
});

// --- NA Report Routes ---
app.post("/api/na/reports", naAuthMiddleware, async (req, res) => {
  try {
    const caregiver = req.caregiver;
    let {
      bookingId,
      date,
      childName,
      records,
      status,
    } = req.body;

    // Night-duty fix — report date ကို active duty ရဲ့ dutyStart ရက်နဲ့ ချည်ထားတယ်
    // (မနက်ဖြန် ၁၂ နာရီကျော်ပြီး record လုပ်လည်း တစည်းဘတ် report တည်းကို update ဖြစ်စေဖို့)
    const activeDuty = await DutyLog.findOne({
      caregiver: caregiver._id,
      booking: bookingId,
      status: "active",
    });

    let reportDate = null;
    if (activeDuty?.dutyStart) {
      // ၂၄ နာရီအောက် duty (night shift အပါအဝင်) → dutyStart ရက်ပဲ သုံး
      // ၂၄ နာရီကျော်နေတဲ့ ဆက်တိုက် duty (weekly/live-in) → ဒီနေ့ရက်ကို ရွှေ့သုံး
      const startedAt = new Date(activeDuty.dutyStart);
      const hoursActive = (Date.now() - startedAt.getTime()) / 36e5;
      reportDate = hoursActive >= 24 ? new Date() : new Date(startedAt);
      reportDate.setUTCHours(0, 0, 0, 0);
    } else if (date) {
      reportDate = new Date(date);
      if (!isNaN(reportDate.getTime())) {
        reportDate.setUTCHours(0, 0, 0, 0);
      }
    }

    if (!reportDate || isNaN(reportDate.getTime())) {
      return sendError(res, "Valid date or active duty is required");
    }

    // Auto-resolve childName from parent's children if not provided
    if (!childName) {
      const booking = await Booking.findById(bookingId).populate("parent");
      const parent = booking?.parent;
      if (parent?.children?.length > 0) {
        childName = parent.children[0].childName;
      } else {
        childName = booking?.customerName || "Unknown";
      }
    }

    // Check if report already exists for this date and booking
    const existingReport = await DailyReport.findOne({
      caregiver: caregiver._id,
      booking: bookingId,
      date: reportDate,
      childName,
    });

    if (existingReport) {
      // Update existing report
      Object.assign(existingReport, {
        records,
        status,
        submittedAt: status === "submitted" ? new Date() : undefined,
      });
      await existingReport.save();
      return sendSuccess(res, existingReport, "Report updated");
    }

    // Get booking for parent reference
    const booking = await Booking.findById(bookingId);

    const report = new DailyReport({
      caregiver: caregiver._id,
      caregiverName: caregiver.caregiverName,
      parent: booking?.parent,
      childName,
      booking: bookingId,
      date: reportDate,
      records,
      status: status || "draft",
      submittedAt: status === "submitted" ? new Date() : undefined,
    });
    await report.save();

    sendSuccess(res, report, "Report created", 201);
  } catch (err) {
    sendError(res, err.message, 400);
  }
});

app.get("/api/na/reports", naAuthMiddleware, async (req, res) => {
  try {
    const caregiver = req.caregiver;
    const { date, bookingId } = req.query;

    const filter = { caregiver: caregiver._id };
    if (date) {
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);
      filter.date = { $gte: startOfDay, $lte: endOfDay };
    }
    if (bookingId) {
      filter.booking = bookingId;
    }

    const reports = await DailyReport.find(filter)
      .sort({ date: -1 })
      .populate("booking");

    sendSuccess(res, reports);
  } catch (err) {
    sendError(res, err.message, 400);
  }
});

app.get("/api/na/reports/:id", naAuthMiddleware, async (req, res) => {
  try {
    const report = await DailyReport.findOne({
      _id: req.params.id,
      caregiver: req.caregiver._id,
    }).populate("booking");

    if (!report) {
      return sendError(res, "Report not found");
    }
    sendSuccess(res, report);
  } catch (err) {
    sendError(res, err.message, 400);
  }
});

app.put("/api/na/reports/:id", naAuthMiddleware, async (req, res) => {
  try {
    const report = await DailyReport.findOne({
      _id: req.params.id,
      caregiver: req.caregiver._id,
    });

    if (!report) {
      return sendError(res, "Report not found");
    }
    if (report.status === "submitted") {
      return sendError(res, "Cannot edit submitted report");
    }

    const {
      records,
      status,
    } = req.body;

    Object.assign(report, {
      records,
      status,
      submittedAt: status === "submitted" ? new Date() : report.submittedAt,
    });
    await report.save();

    sendSuccess(res, report, "Report updated");
  } catch (err) {
    sendError(res, err.message, 400);
  }
});

app.delete("/api/na/reports/:id", naAuthMiddleware, async (req, res) => {
  try {
    const report = await DailyReport.findOne({
      _id: req.params.id,
      caregiver: req.caregiver._id,
    });

    if (!report) {
      return sendError(res, "Report not found");
    }
    if (report.status === "submitted") {
      return sendError(res, "Cannot delete submitted report");
    }

    await DailyReport.findByIdAndDelete(req.params.id);
    sendSuccess(res, null, "Report deleted");
  } catch (err) {
    sendError(res, err.message, 400);
  }
});

// --- Admin NA Routes ---
app.get(
  "/api/admin/na-reports",
  authMiddleware,
  roleMiddleware(["admin"]),
  async (req, res) => {
    try {
      const { date, caregiverId, status } = req.query;
      const filter = {};

      if (date) {
        const startOfDay = new Date(date);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(date);
        endOfDay.setHours(23, 59, 59, 999);
        filter.date = { $gte: startOfDay, $lte: endOfDay };
      }
      if (caregiverId) filter.caregiver = caregiverId;
      if (status) filter.status = status;

      const reports = await DailyReport.find(filter)
        .sort({ date: -1 })
        .populate("caregiver", "caregiverName")
        .populate("booking");

      sendSuccess(res, reports);
    } catch (err) {
      sendError(res, err.message, 400);
    }
  },
);

app.get(
  "/api/admin/na-reports/:id",
  authMiddleware,
  roleMiddleware(["admin"]),
  async (req, res) => {
    try {
      const report = await DailyReport.findById(req.params.id)
        .populate("caregiver", "caregiverName")
        .populate("booking");

      if (!report) {
        return sendError(res, "Report not found");
      }
      sendSuccess(res, report);
    } catch (err) {
      sendError(res, err.message, 400);
    }
  },
);

app.post(
  "/api/admin/na-reports/:id/ai-summary",
  authMiddleware,
  roleMiddleware(["admin"]),
  async (req, res) => {
    try {
      const openRouterKey = process.env.OPENROUTER_API_KEY;
      const geminiKey =
        process.env.GEMINI_API_KEY ||
        process.env.GOOGLE_AI_STUDIO_API_KEY ||
        process.env.GOOGLE_API_KEY;

      if (!openRouterKey && !geminiKey) {
        return sendError(
          res,
          "Please configure OPENROUTER_API_KEY (or GEMINI_API_KEY) in backend/.env",
          400
        );
      }

      const report = await DailyReport.findById(req.params.id)
        .populate("caregiver", "caregiverName")
        .populate("booking");

      if (!report) {
        return sendError(res, "Report not found");
      }

      const childName = report.childName || "Child";
      const caregiverName =
        report.caregiver?.caregiverName ||
        report.caregiverName ||
        "Nurse Aid";
      const reportDate = report.date
        ? new Date(report.date).toISOString().split("T")[0]
        : "N/A";
      const records = report.records || [];

      if (records.length === 0) {
        return sendError(
          res,
          "No records available in this report to generate an AI summary.",
          400
        );
      }

      const prompt = `You are an expert pediatric nurse care coordinator and clinical supervisor at Healthy Nara (ကလေးသူငယ်နှင့် မိသားစု ကျန်းမာရေး ပြုစုစောင့်ရှောက်မှု အဖွဲ့).
Analyze the following daily care report logged by the Nurse Aid / Caregiver and generate a structured, highly professional, warm, and clean Daily Care Summary in MYANMAR LANGUAGE ONLY (မြန်မာဘာသာ သီးသန့်ဖြင့်သာ ရေးသားပေးပါ).

### အချက်အလက်များ (REPORT DETAILS):
- ကလေးအမည် (Child Name): ${childName}
- ပြုစုစောင့်ရှောက်သူ (Caregiver / Nurse Aid): ${caregiverName}
- ရက်စွဲ (Date): ${reportDate}
- တာဝန်အခြေအနေ (Duty Status): ${report.status}
- မှတ်တမ်းတင်ထားသော အချက်အရေအတွက်: ${records.length} ခု

### မှတ်တမ်းတင်ထားသော ပြုစုစောင့်ရှောက်မှု အချက်များ (LOGGED ACTIVITIES):
${records
          .map(
            (r, i) =>
              `${i + 1}. [${r.category}] အချိန် ${r.time}: ${r.desc}`
          )
          .join("\n")}

### ရေးသားရမည့် ပုံစံနှင့် သတ်မှတ်ချက်များ (INSTRUCTIONS FOR OUTPUT):
မြန်မာဘာသာစကားဖြင့် သာယာချောမွေ့စွာ၊ ဆေးဘက်ဆိုင်ရာ ကျွမ်းကျင်မှုရှိစွာနှင့် ဖတ်ရှုသူ မိဘများ စိတ်အေးချမ်းသာစေမည့် အသုံးအနှုန်းများဖြင့် အောက်ပါ Markdown ခေါင်းစဉ်များအတိုင်း စနစ်တကျ အစီရင်ခံစာ ရေးသားပေးပါ-

1. **🌟 နေ့စဉ် ပြုစုစောင့်ရှောက်မှု အကျဉ်းချုပ် (Executive Summary)**:
   - ကလေးငယ်၏ တစ်နေ့တာ အထွေထွေ ကျန်းမာရေး၊ လန်းဆန်းမှုနှင့် နေ့စဉ်အခြေအနေ အကျဉ်းချုပ်။

2. **📋 အဓိက ပြုစုစောင့်ရှောက်မှု မှတ်တမ်းများ (Care Highlights)**:
   - **🍲 အာဟာရနှင့် အစာကျွေးမွေးမှု (Nutrition & Feeding)**: အစာစားချိန်၊ နို့/အစားအသောက် စားသောက်မှု ပမာဏနှင့် အာဟာရရရှိမှု အခြေအနေ။
   - **🧼 တစ်ကိုယ်ရည် သန့်ရှင်းရေး (Hygiene & Comfort)**: ရေချိုးပေးခြင်း၊ အဝတ်အစားနှင့် ဒိုင်ပါလဲပေးမှု၊ သန့်ရှင်းမှု အခြေအနေ။
   - **🛌 အိပ်စက်အနားယူမှု (Rest & Sleep)**: နေ့လယ်/ည အိပ်စက်ချိန် အပိုင်းအခြား၊ အိပ်ပျော်မှု အရည်အသွေးနှင့် ကြာချိန်။
   - **🎨 ကစားလှုပ်ရှားမှုနှင့် စိတ်ခံစားမှု (Activities & Mood)**: ကလေး၏ စိတ်ပျော်ရွှင်မှု၊ ဉာဏ်ရည်နှင့် ကိုယ်လက်လှုပ်ရှား ကစားမှုများ။

3. **🔍 ကျန်းမာရေး စောင့်ကြည့်စစ်ဆေးချက်နှင့် ထူးခြားဖြစ်စဉ်များ (Clinical Observations & Unusual Findings)**:
   - ကိုယ်အပူချိန်၊ အဖျား၊ ဝမ်းသွားမှု၊ ဓာတ်မတည့်မှု သို့မဟုတ် ထူးခြားဖြစ်စဉ်များ ရှိ/မရှိ (ထူးခြားဖြစ်စဉ် မရှိပါက 'ထူးခြားဖြစ်စဉ် သို့မဟုတ် ကျန်းမာရေးဆိုင်ရာ စိုးရိမ်ဖွယ်ရာ မရှိဘဲ ပုံမှန်အတိုင်း ကျန်းမာတည်ငြိမ်လျက် ရှိပါသည်' ဟု ရေးပေးပါ)။

4. **💡 မိဘများနှင့် နောက်တာဝန်ကျ ဆရာမအတွက် အကြံပြုချက်များ (Recommendations)**:
   - မိဘများနှင့် နောက်ဆိုင်းတာဝန်ကျ ဆရာမများ ဆက်လက် သတိပြု ဆောင်ရွက်ပေးသင့်သည့် လက်တွေ့ အကြံပြုချက်များ။

အရေးကြီးသည်မှာ အင်္ဂလိပ်စာလုံးများ မရောနှောဘဲ အဓိပ္ပာယ်ပြည့်ဝသော မြန်မာဘာသာ (Myanmar language) ဖြင့်သာ အပြည့်အစုံ ရေးသားထုတ်ပေးရပါမည်။`;

      let summaryText = "";
      let lastErr = null;

      // 1. If OPENROUTER_API_KEY is configured, prioritize OpenRouter API
      if (openRouterKey) {
        const openRouterModels = [
          "google/gemini-2.5-flash",
          "google/gemini-2.0-flash-exp:free",
          "meta-llama/llama-3.3-70b-instruct:free",
          "openai/gpt-4o-mini",
          "anthropic/claude-3.5-haiku",
        ];

        for (const model of openRouterModels) {
          try {
            const resp = await fetch(
              "https://openrouter.ai/api/v1/chat/completions",
              {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${openRouterKey}`,
                  "HTTP-Referer": "https://healthynara.com",
                  "X-Title": "Healthy Nara Care System",
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  model: model,
                  messages: [
                    {
                      role: "system",
                      content:
                        "You are an expert pediatric nurse care coordinator and clinical supervisor at Healthy Nara. You must generate the entire daily care summary in natural, professional Myanmar language (မြန်မာဘာသာ) only.",
                    },
                    { role: "user", content: prompt },
                  ],
                  temperature: 0.4,
                  max_tokens: 1500,
                }),
              }
            );

            if (resp.ok) {
              const data = await resp.json();
              summaryText =
                data?.choices?.[0]?.message?.content || "";
              if (summaryText) break;
            } else {
              const errData = await resp.json().catch(() => ({}));
              lastErr = errData?.error?.message || resp.statusText;
            }
          } catch (e) {
            lastErr = e.message;
          }
        }
      }

      // 2. Fallback to Gemini Direct API if OpenRouter didn't succeed or wasn't provided
      if (!summaryText && geminiKey) {
        const geminiModels = [
          "gemini-2.5-flash",
          "gemini-3.5-flash-lite",
          "gemini-3.6-flash",
        ];

        for (const model of geminiModels) {
          try {
            const resp = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  contents: [{ parts: [{ text: prompt }] }],
                  generationConfig: {
                    temperature: 0.4,
                    maxOutputTokens: 2048,
                  },
                }),
              }
            );

            if (resp.ok) {
              const data = await resp.json();
              summaryText =
                data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
              if (summaryText) break;
            } else {
              const errData = await resp.json().catch(() => ({}));
              lastErr = errData?.error?.message || resp.statusText;
            }
          } catch (e) {
            lastErr = e.message;
          }
        }
      }

      if (!summaryText) {
        return sendError(
          res,
          `Google AI Studio Error: ${lastErr || "Unable to generate summary"}. Please make sure you are using a standard Free API Key from https://aistudio.google.com/app/apikey (starts with AIzaSy...).`,
          500
        );
      }

      // Save / update summary in database (supports multiple re-generations)
      report.aiSummary = summaryText;
      report.aiSummaryGeneratedAt = new Date();
      await report.save();

      sendSuccess(
        res,
        {
          aiSummary: report.aiSummary,
          aiSummaryGeneratedAt: report.aiSummaryGeneratedAt,
        },
        "AI Summary generated successfully"
      );
    } catch (err) {
      sendError(res, err.message, 500);
    }
  },
);

app.get(
  "/api/admin/duty-logs",
  authMiddleware,
  roleMiddleware(["admin"]),
  async (req, res) => {
    try {
      const { date, caregiverId } = req.query;
      const filter = {};

      if (date) {
        const startOfDay = new Date(date);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(date);
        endOfDay.setHours(23, 59, 59, 999);
        filter.date = { $gte: startOfDay, $lte: endOfDay };
      }
      if (caregiverId) filter.caregiver = caregiverId;

      const logs = await DutyLog.find(filter)
        .sort({ dutyStart: -1 })
        .populate("caregiver", "caregiverName")
        .populate("booking");

      sendSuccess(res, logs);
    } catch (err) {
      sendError(res, err.message, 400);
    }
  },
);

// --- Family Routes (Public, token-based) ---
app.get("/api/family/:token/reports", async (req, res) => {
  try {
    const { token } = req.params;

    // Find booking by token to get parent reference
    const booking = await Booking.findOne({ bookingToken: token });
    if (!booking) {
      return sendError(res, "Invalid token");
    }

    const reports = await DailyReport.find({
      parent: booking.parent,
      booking: booking._id,
    })
      .sort({ date: -1 })
      .populate("caregiver", "caregiverName");

    sendSuccess(res, { reports, booking });
  } catch (err) {
    sendError(res, err.message, 400);
  }
});

app.get("/api/family/:token/reports/:date", async (req, res) => {
  try {
    const { token, date } = req.params;

    const booking = await Booking.findOne({ bookingToken: token });
    if (!booking) {
      return sendError(res, "Invalid token");
    }

    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const report = await DailyReport.findOne({
      parent: booking.parent,
      booking: booking._id,
      date: { $gte: startOfDay, $lte: endOfDay },
    }).populate("caregiver", "caregiverName");

    sendSuccess(res, report);
  } catch (err) {
    sendError(res, err.message, 400);
  }
});

// --- Ticket Routes ---
const addTicketHistory = async (ticketId, userId, userName, action) => {
  try {
    await new TicketHistory({ ticket_id: ticketId, user_id: userId, userName, action_performed: action }).save();
  } catch (err) {
    console.error(">>> TICKET HISTORY ERROR:", err.message);
  }
};

// List tickets (admin all; staff own created or assigned)
app.get("/api/tickets", authMiddleware, roleMiddleware(["admin", "staff"]), async (req, res) => {
  try {
    const { search, status } = req.query;
    const query = {};
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } }
      ];
    }
    if (status) query.status = status;
    if (req.user.role !== "superadmin") {
      query.$or = [
        ...(query.$or || []),
        { created_by: req.user._id },
        { assigned_to: req.user._id }
      ];
    }
    const tickets = await Ticket.find(query).sort({ createdAt: -1 });
    sendSuccess(res, tickets, "Tickets fetched");
  } catch (error) {
    sendError(res, error.message, 500);
  }
});

// Create ticket
app.post("/api/tickets", authMiddleware, roleMiddleware(["admin", "staff"]), async (req, res) => {
  try {
    const { title, description, priority, assigned_to } = req.body;
    let assignedName;
    if (assigned_to) {
      const u = await User.findById(assigned_to);
      assignedName = u ? u.username : undefined;
    }
    const ticket = new Ticket({
      title,
      description,
      priority,
      assigned_to: assigned_to || undefined,
      assignedName,
      created_by: req.user._id,
      createdByName: req.user.username
    });
    await ticket.save();
    await addTicketHistory(ticket._id, req.user._id, req.user.username, "Created ticket");
    if (ticket.assigned_to) {
      await addTicketHistory(ticket._id, req.user._id, req.user.username, `Assigned to ${assignedName}`);
      notifyTicketAssigned(ticket._id).catch(() => { });
    }
    sendSuccess(res, ticket, "Ticket created", 201);
  } catch (error) {
    sendError(res, error.message, 400);
  }
});

// List users (for assignment dropdown) — MUST be before /:id route
app.get("/api/tickets/users", authMiddleware, roleMiddleware(["admin", "staff"]), async (req, res) => {
  try {
    const users = await User.find({}).select("_id username role");
    sendSuccess(res, users, "Users fetched");
  } catch (error) {
    sendError(res, error.message, 500);
  }
});

// Get ticket + comments + history
app.get("/api/tickets/:id", authMiddleware, roleMiddleware(["admin", "staff"]), async (req, res) => {
  try {
    const ticket = await Ticket.findById(req.params.id);
    if (!ticket) return sendError(res, "Ticket not found", 404);
    if (req.user.role !== "superadmin" &&
      ticket.created_by.toString() !== req.user._id.toString() &&
      (!ticket.assigned_to || ticket.assigned_to.toString() !== req.user._id.toString())) {
      return sendError(res, "Access denied", 403);
    }
    const comments = await TicketComment.find({ ticket_id: ticket._id }).sort({ createdAt: 1 });
    const history = await TicketHistory.find({ ticket_id: ticket._id }).sort({ createdAt: 1 });
    sendSuccess(res, { ticket, comments, history }, "Ticket fetched");
  } catch (error) {
    sendError(res, error.message, 500);
  }
});

// Assign ticket (admin only)
app.put("/api/tickets/:id/assign", authMiddleware, roleMiddleware(["admin"]), async (req, res) => {
  try {
    const { userId } = req.body;
    const ticket = await Ticket.findById(req.params.id);
    if (!ticket) return sendError(res, "Ticket not found", 404);

    const user = userId ? await User.findById(userId) : null;
    ticket.assigned_to = user ? user._id : undefined;
    ticket.assignedName = user ? user.username : undefined;
    await ticket.save();

    await addTicketHistory(ticket._id, req.user._id, req.user.username, user ? `Assigned to ${user.username}` : "Unassigned");
    if (user) notifyTicketAssigned(ticket._id).catch(() => { });
    sendSuccess(res, ticket, "Ticket assigned");
  } catch (error) {
    sendError(res, error.message, 400);
  }
});

// Update status
app.put("/api/tickets/:id/status", authMiddleware, roleMiddleware(["admin", "staff"]), async (req, res) => {
  try {
    const { status } = req.body;
    if (!["Open", "In Progress", "Pending", "Resolved"].includes(status)) {
      return sendError(res, "Invalid status", 400);
    }
    const ticket = await Ticket.findById(req.params.id);
    if (!ticket) return sendError(res, "Ticket not found", 404);
    if (req.user.role !== "superadmin" &&
      ticket.created_by.toString() !== req.user._id.toString() &&
      (!ticket.assigned_to || ticket.assigned_to.toString() !== req.user._id.toString())) {
      return sendError(res, "Access denied", 403);
    }
    const oldStatus = ticket.status;
    ticket.status = status;
    await ticket.save();
    await addTicketHistory(ticket._id, req.user._id, req.user.username, `Changed status from ${oldStatus} to ${status}`);
    sendSuccess(res, ticket, "Status updated");
  } catch (error) {
    sendError(res, error.message, 400);
  }
});

// Add comment
app.post("/api/tickets/:id/comments", authMiddleware, roleMiddleware(["admin", "staff"]), async (req, res) => {
  try {
    const { message } = req.body;
    const ticket = await Ticket.findById(req.params.id);
    if (!ticket) return sendError(res, "Ticket not found", 404);
    const comment = new TicketComment({
      ticket_id: ticket._id,
      user_id: req.user._id,
      userName: req.user.username,
      message
    });
    await comment.save();
    await addTicketHistory(ticket._id, req.user._id, req.user.username, "Added comment");
    notifyTicketCommented(ticket._id, req.user.username, message).catch(() => { });
    sendSuccess(res, comment, "Comment added", 201);
  } catch (error) {
    sendError(res, error.message, 400);
  }
});

// Delete ticket (admin or creator)
app.delete("/api/tickets/:id", authMiddleware, roleMiddleware(["admin", "staff"]), async (req, res) => {
  try {
    const ticket = await Ticket.findById(req.params.id);
    if (!ticket) return sendError(res, "Ticket not found", 404);
    if (req.user.role !== "superadmin" &&
      ticket.created_by.toString() !== req.user._id.toString() &&
      (!ticket.assigned_to || ticket.assigned_to.toString() !== req.user._id.toString())) {
      return sendError(res, "Access denied", 403);
    }
    await Ticket.deleteOne({ _id: ticket._id });
    await TicketComment.deleteMany({ ticket_id: ticket._id });
    await TicketHistory.deleteMany({ ticket_id: ticket._id });
    sendSuccess(res, null, "Ticket deleted");
  } catch (error) {
    sendError(res, error.message, 500);
  }
});

// --- Team / Users Routes (admin) ---
app.get("/api/users", authMiddleware, roleMiddleware(["superadmin"]), async (req, res) => {
  try {
    const users = await User.find({}).select("_id username role telegramChatId isActive");
    sendSuccess(res, users, "Users fetched");
  } catch (error) {
    sendError(res, error.message, 500);
  }
});

// Create user (admin only)
app.post("/api/users", authMiddleware, roleMiddleware(["superadmin"]), async (req, res) => {
  try {
    const { username, password, role } = req.body;
    if (!username || !password) return sendError(res, "Username and password are required", 400);
    const existing = await User.findOne({ username });
    if (existing) return sendError(res, "User already exists", 400);
    const user = new User({ username, password, role: role || "staff" });
    await user.save(); // pre-save hook hashes the password
    sendSuccess(res, { id: user._id, username: user.username, role: user.role }, "User created", 201);
  } catch (error) {
    sendError(res, error.message, 400);
  }
});

// Update user (role / isActive / telegramChatId) — admin only
app.put("/api/users/:id", authMiddleware, roleMiddleware(["superadmin"]), async (req, res) => {
  try {
    const { role, isActive, telegramChatId } = req.body;
    const user = await User.findById(req.params.id);
    if (!user) return sendError(res, "User not found", 404);

    // Prevent admin from disabling their own account (self-lockout)
    if (isActive === false && req.user._id.toString() === user._id.toString()) {
      return sendError(res, "Cannot disable your own account", 400);
    }

    if (role !== undefined) user.role = role;
    if (isActive !== undefined) user.isActive = isActive;
    if (telegramChatId !== undefined) user.telegramChatId = telegramChatId || undefined;
    await user.save();

    sendSuccess(res, { id: user._id, username: user.username, role: user.role, isActive: user.isActive, telegramChatId: user.telegramChatId }, "User updated");
  } catch (error) {
    // duplicate telegramChatId -> duplicate key error
    sendError(res, error.code === 11000 ? "Telegram Chat ID already in use" : error.message, 400);
  }
});

// Reset password (admin only)
app.put("/api/users/:id/password", authMiddleware, roleMiddleware(["superadmin"]), async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 4) return sendError(res, "Password must be at least 4 characters", 400);
    const user = await User.findById(req.params.id);
    if (!user) return sendError(res, "User not found", 404);
    user.password = newPassword; // pre-save hook hashes it
    await user.save();
    sendSuccess(res, null, "Password reset");
  } catch (error) {
    sendError(res, error.message, 400);
  }
});

// --- Telegram Webhook (public, Telegram POSTs here) ---
app.post("/api/telegram/webhook", async (req, res) => {
  try {
    const body = req.body;
    console.log(">>> [Telegram Webhook POST received]:", {
      update_id: body?.update_id,
      callback_data: body?.callback_query?.data,
      from: body?.callback_query?.from?.username || body?.callback_query?.from?.id,
      message_text: body?.message?.text
    });

    if (body?.callback_query) {
      await processTicketCallback(body.callback_query);
    }
    if (body?.message) {
      await processIncomingMessage(body.message);
    }
    res.status(200).json({ ok: true });
  } catch (error) {
    console.error(">>> WEBHOOK ERROR:", error.message);
    res.status(200).json({ ok: true });
  }
});

// GET /api/telegram/webhook-status - Inspect live Telegram webhook status
app.get("/api/telegram/webhook-status", async (req, res) => {
  try {
    const info = await getTelegramWebhookStatus();
    sendSuccess(res, {
      configuredWebhookUrl: process.env.TELEGRAM_WEBHOOK_URL,
      telegramInfo: info
    });
  } catch (error) {
    sendError(res, error.message, 500);
  }
});

// POST /api/telegram/set-webhook - Force set/update Telegram webhook URL
app.post("/api/telegram/set-webhook", async (req, res) => {
  try {
    const customUrl = req.body?.url || req.query?.url;
    const result = await initTelegramWebhook(customUrl);
    const info = await getTelegramWebhookStatus();
    sendSuccess(res, {
      result,
      telegramInfo: info
    }, "Telegram webhook registered successfully");
  } catch (error) {
    sendError(res, error.message, 500);
  }
});

// --- Blog Slug Helper ---
const generateBlogSlug = async (title, currentId = null) => {
  let baseSlug = title
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!baseSlug) baseSlug = "post";

  let slug = baseSlug;
  let count = 1;
  while (true) {
    const existing = await Blog.findOne({ slug });
    if (!existing || (currentId && existing._id.toString() === currentId.toString())) {
      break;
    }
    slug = `${baseSlug}-${count}`;
    count++;
  }
  return slug;
};

// --- Blog Routes ---

// GET /api/blogs — List all blogs with filters & stats
app.get("/api/blogs", async (req, res) => {
  try {
    const { search, category, status, isFeatured, page = 1, limit = 50, sort = "-createdAt" } = req.query;
    const query = {};

    if (search) {
      const regex = new RegExp(search, "i");
      query.$or = [{ title: regex }, { excerpt: regex }, { tags: regex }, { authorName: regex }];
    }

    if (category && category !== "All") {
      query.category = category;
    }

    if (status && status !== "All") {
      query.status = status;
    }

    if (isFeatured !== undefined) {
      query.isFeatured = isFeatured === "true" || isFeatured === true;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [blogs, total, stats] = await Promise.all([
      Blog.find(query).sort(sort).skip(skip).limit(parseInt(limit)),
      Blog.countDocuments(query),
      Blog.aggregate([
        {
          $group: {
            _id: null,
            totalPosts: { $sum: 1 },
            publishedPosts: {
              $sum: { $cond: [{ $eq: ["$status", "Published"] }, 1, 0] },
            },
            draftPosts: {
              $sum: { $cond: [{ $eq: ["$status", "Draft"] }, 1, 0] },
            },
            totalViews: { $sum: "$viewCount" },
          },
        },
      ]),
    ]);

    const summaryStats = stats[0] || {
      totalPosts: 0,
      publishedPosts: 0,
      draftPosts: 0,
      totalViews: 0,
    };

    sendSuccess(res, {
      blogs,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit)),
      stats: summaryStats,
    });
  } catch (error) {
    sendError(res, error.message, 500);
  }
});

// GET /api/blogs/:idOrSlug — Get single blog by ID or Slug (with optional view increment)
app.get("/api/blogs/:idOrSlug", async (req, res) => {
  try {
    const { idOrSlug } = req.params;
    const isObjectId = mongoose.Types.ObjectId.isValid(idOrSlug);

    let blog;
    if (isObjectId) {
      blog = await Blog.findByIdAndUpdate(
        idOrSlug,
        { $inc: { viewCount: 1 } },
        { new: true }
      );
    } else {
      blog = await Blog.findOneAndUpdate(
        { slug: idOrSlug },
        { $inc: { viewCount: 1 } },
        { new: true }
      );
    }

    if (!blog) return sendError(res, "Blog post not found", 404);
    sendSuccess(res, blog);
  } catch (error) {
    sendError(res, error.message, 500);
  }
});

// ============================================================================
// PUBLIC PORTFOLIO / CLIENT BLOG APIS (No Authentication Required)
// ============================================================================

// 1. GET /api/public/blogs/featured - Get featured published blogs for hero/spotlight
app.get("/api/public/blogs/featured", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 4, 10);
    const blogs = await Blog.find({
      status: "Published",
      isFeatured: true,
    })
      .select("-content")
      .sort("-publishedAt")
      .limit(limit);

    sendSuccess(res, blogs, "Featured blogs retrieved successfully");
  } catch (error) {
    sendError(res, error.message, 500);
  }
});

// 2. GET /api/public/blogs/categories - Get category list with published post counts
app.get("/api/public/blogs/categories", async (req, res) => {
  try {
    const categoryCounts = await Blog.aggregate([
      { $match: { status: "Published" } },
      {
        $group: {
          _id: "$category",
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
    ]);

    const totalPublished = await Blog.countDocuments({ status: "Published" });
    const categories = [
      { name: "All", count: totalPublished },
      ...categoryCounts.map((c) => ({ name: c._id || "General", count: c.count })),
    ];

    sendSuccess(res, categories, "Categories retrieved successfully");
  } catch (error) {
    sendError(res, error.message, 500);
  }
});

// 3. GET /api/public/blogs - List published blogs with pagination, filters & lightweight payload
app.get("/api/public/blogs", async (req, res) => {
  try {
    const {
      search,
      category,
      tag,
      page = 1,
      limit = 9,
      sort = "-publishedAt",
    } = req.query;

    const query = { status: "Published" };

    if (search) {
      const regex = new RegExp(search, "i");
      query.$or = [
        { title: regex },
        { excerpt: regex },
        { tags: regex },
        { authorName: regex },
      ];
    }

    if (category && category !== "All") {
      query.category = category;
    }

    if (tag) {
      query.tags = tag;
    }

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(Math.max(1, parseInt(limit)), 50);
    const skip = (pageNum - 1) * limitNum;

    const [blogs, total] = await Promise.all([
      Blog.find(query)
        .select("-content") // Exclude heavy body for fast list rendering
        .sort(sort)
        .skip(skip)
        .limit(limitNum),
      Blog.countDocuments(query),
    ]);

    const totalPages = Math.ceil(total / limitNum);

    sendSuccess(res, {
      blogs,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages,
        hasNext: pageNum < totalPages,
        hasPrev: pageNum > 1,
      },
    });
  } catch (error) {
    sendError(res, error.message, 500);
  }
});

// 4. GET /api/public/blogs/:slugOrId - Get single published blog by slug or ID with related posts
app.get("/api/public/blogs/:slugOrId", async (req, res) => {
  try {
    const { slugOrId } = req.params;
    const isObjectId = mongoose.Types.ObjectId.isValid(slugOrId);

    const filter = isObjectId
      ? { _id: slugOrId, status: "Published" }
      : { slug: slugOrId, status: "Published" };

    const blog = await Blog.findOneAndUpdate(
      filter,
      { $inc: { viewCount: 1 } },
      { new: true }
    );

    if (!blog) {
      return sendError(res, "Published blog post not found", 404);
    }

    // Fetch up to 3 related articles from same category
    const relatedBlogs = await Blog.find({
      _id: { $ne: blog._id },
      category: blog.category,
      status: "Published",
    })
      .select("-content")
      .sort("-publishedAt")
      .limit(3);

    sendSuccess(res, {
      blog,
      relatedBlogs,
    });
  } catch (error) {
    sendError(res, error.message, 500);
  }
});

// POST /api/blogs — Create new blog
app.post("/api/blogs", authMiddleware, roleMiddleware(["admin", "staff"]), async (req, res) => {
  try {
    const {
      title,
      slug: customSlug,
      excerpt,
      content,
      coverImage,
      category,
      tags,
      status = "Draft",
      isFeatured = false,
      publishedAt,
    } = req.body;

    if (!title || !title.trim()) {
      return sendError(res, "Title is required", 400);
    }

    if (!content || !content.trim()) {
      return sendError(res, "Content is required", 400);
    }

    // Auto-generate or sanitize slug
    const finalSlug = customSlug && customSlug.trim()
      ? await generateBlogSlug(customSlug)
      : await generateBlogSlug(title);

    // Calculate estimated reading time
    const wordCount = content.replace(/<[^>]*>/g, " ").trim().split(/\s+/).length;
    const readTimeMinutes = Math.max(1, Math.ceil(wordCount / 200));

    const blog = new Blog({
      title: title.trim(),
      slug: finalSlug,
      excerpt: excerpt?.trim() || "",
      content: content.trim(),
      coverImage: coverImage?.trim() || "",
      category: category || "General",
      tags: Array.isArray(tags) ? tags : typeof tags === "string" ? tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
      author: req.user._id,
      authorName: req.user.name || req.user.username || "Staff",
      status,
      isFeatured: Boolean(isFeatured),
      publishedAt: status === "Published" ? (publishedAt ? new Date(publishedAt) : new Date()) : null,
      readTimeMinutes,
    });

    await blog.save();

    await createLog(
      req,
      "CREATE_BLOG",
      "Blog",
      blog._id.toString(),
      `Created blog: ${blog.title} (${blog.slug})`
    );

    sendSuccess(res, blog, "Blog post created successfully", 201);
  } catch (error) {
    sendError(res, error.message, 400);
  }
});

// PUT /api/blogs/:id — Update blog
app.put("/api/blogs/:id", authMiddleware, roleMiddleware(["admin", "staff"]), async (req, res) => {
  try {
    const { id } = req.params;
    const blog = await Blog.findById(id);
    if (!blog) return sendError(res, "Blog post not found", 404);

    const {
      title,
      slug: customSlug,
      excerpt,
      content,
      coverImage,
      category,
      tags,
      status,
      isFeatured,
      publishedAt,
    } = req.body;

    if (title && title.trim()) {
      blog.title = title.trim();
    }

    if (customSlug && customSlug.trim()) {
      blog.slug = await generateBlogSlug(customSlug, blog._id);
    } else if (title && title.trim() && title.trim() !== blog.title) {
      blog.slug = await generateBlogSlug(title, blog._id);
    }

    if (excerpt !== undefined) blog.excerpt = excerpt.trim();
    if (content !== undefined) {
      blog.content = content.trim();
      const wordCount = content.replace(/<[^>]*>/g, " ").trim().split(/\s+/).length;
      blog.readTimeMinutes = Math.max(1, Math.ceil(wordCount / 200));
    }
    if (coverImage !== undefined) blog.coverImage = coverImage.trim();
    if (category !== undefined) blog.category = category;
    if (tags !== undefined) {
      blog.tags = Array.isArray(tags) ? tags : typeof tags === "string" ? tags.split(",").map((t) => t.trim()).filter(Boolean) : [];
    }
    if (isFeatured !== undefined) blog.isFeatured = Boolean(isFeatured);

    if (status !== undefined) {
      const prevStatus = blog.status;
      blog.status = status;
      if (status === "Published" && (!blog.publishedAt || prevStatus !== "Published")) {
        blog.publishedAt = publishedAt ? new Date(publishedAt) : new Date();
      }
    }

    await blog.save();

    await createLog(
      req,
      "UPDATE_BLOG",
      "Blog",
      blog._id.toString(),
      `Updated blog: ${blog.title}`
    );

    sendSuccess(res, blog, "Blog post updated successfully");
  } catch (error) {
    sendError(res, error.message, 400);
  }
});

// PATCH /api/blogs/:id/status — Toggle status
app.patch("/api/blogs/:id/status", authMiddleware, roleMiddleware(["admin", "staff"]), async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!["Draft", "Published", "Archived"].includes(status)) {
      return sendError(res, "Invalid status", 400);
    }

    const blog = await Blog.findById(id);
    if (!blog) return sendError(res, "Blog post not found", 404);

    blog.status = status;
    if (status === "Published" && !blog.publishedAt) {
      blog.publishedAt = new Date();
    }

    await blog.save();

    await createLog(
      req,
      "STATUS_BLOG",
      "Blog",
      blog._id.toString(),
      `Changed blog status to ${status}: ${blog.title}`
    );

    sendSuccess(res, blog, `Blog status updated to ${status}`);
  } catch (error) {
    sendError(res, error.message, 400);
  }
});

// DELETE /api/blogs/:id — Delete blog
app.delete("/api/blogs/:id", authMiddleware, roleMiddleware(["admin", "staff"]), async (req, res) => {
  try {
    const { id } = req.params;
    const blog = await Blog.findByIdAndDelete(id);
    if (!blog) return sendError(res, "Blog post not found", 404);

    await createLog(
      req,
      "DELETE_BLOG",
      "Blog",
      blog._id.toString(),
      `Deleted blog: ${blog.title}`
    );

    sendSuccess(res, null, "Blog post deleted successfully");
  } catch (error) {
    sendError(res, error.message, 400);
  }
});

// --- Error Middleware ---
app.use((err, req, res, next) => {
  sendError(res, err.message, err.status || 500);
});

import http from "http";

const server = http.createServer((req, res) => {
  console.log("--- INCOMING RAW REQUEST:", req.method, req.url);
  app(req, res);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT} (0.0.0.0)`);
  initTelegramService().catch((err) => {
    console.error(">>> [Telegram Init Error]:", err.message);
  });
});

export default app;

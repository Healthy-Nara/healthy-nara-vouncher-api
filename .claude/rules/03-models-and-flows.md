# Models & Flows — စည်းမျဉ်း (Rule)

Mongoose model တွေ၊ auto side-effect တွေနဲ့ enum တန်ဖိုးတွေကို ဒီကစစ်ပါ။ Model file တွေက `models/` ထဲမှာရှိတယ်။

## Model ချိတ်ဆက်မှု (Relationships)

- **Invoice** → refs: `Parent`၊ `Caregiver`၊ `Booking`။ Lookup က `invoiceNumber` (unique)၊ `_id` မဟုတ်ဘူး။
- **Booking** → refs: `lead`၊ `selectedCaregiver`၊ `invoice`၊ `parent`။ `bookingNumber` + `bookingToken` (public) unique။
- **Parent** → `leadId` ref + `children[]`။ **Caregiver** → `availability[]` (date, isBooked, bookingId) + NA auth fields (`username` sparse unique, `password`)။
- **Lead** → `conversationLogs[]` (soft-delete via `isDeleted`), `assignedStaff`, `tags[]`။
- **DailyReport / DutyLog** — caregiver/booking/parent/childName/date ကို ref/name နဲ့ မှတ်တယ်။ DailyReport မှာ compound unique index `{caregiver, date, booking, childName}` (line 91)။
- **Customer.js** — legacy/unused (index.js က import မလုပ်ဘူး)။ အသုံးမဝင်တဲ့ code ထည့်ဖို့ မလိုပါ။

## Auto side-effects (သတိထားရမယ်)

- **NA assign** (`PATCH /api/bookings/:id/assign`) → caregiver availability block + **date/child တစ်ခုချင်းစီအတွက် DailyReport auto-create**။
- **Generate invoice** (`POST /api/bookings/:id/generate-invoice`) → invoice ဖန်တီးပြီး booking နဲ့ ချိတ်တယ် (platform fee ပါ)။
- **Convert lead** (`POST /api/leads/:id/convert`) → Parent + Booking ဖန်တီးတယ်။
- **Delete parent/caregiver** → related invoices ရဲ့ ref ကို `null` လုပ်တယ် (cascade မလုပ်ဘူး)။

## Invoice state flow

- Invoice status: `Draft | Created | Sent | Payment Confirmed | Payout Completed`
- `customerPaymentStatus`: `Pending | Received`
- `caregiverPayoutStatus`: `Pending | Paid`
- Overall `status`: `Pending | Completed`
- **Auto-complete**: payment `Received` + payout `Paid` ဖြစ်ရင် `Completed` (`checkAndUpdateInvoiceCompletion`၊ `index.js:201` — ဒါက `status` ကိုပဲ update လုပ်တယ်၊ `invoiceStatus` မဟုတ်ဘူး)။

## Enums (schema ထဲက သတ်မှတ်ထားတဲ့)

- **Lead stage**: `New | Contacted | Sale Closed | Bookinged | Active Customer | Lost`
- **Booking status**: `Pending NA Selection | Assigned | Completed | Cancelled`
- **Service package**: `Newborn Service | Childcare Service | N/A`
- **Payment channel**: `Kpay | AYAPay | WavePay` (အဓိက)

## တည်းဖြတ်ရင် (When editing)

- Enum တန်ဖိုးတွေကို မပြောင်းခင် `migrate_stages.js` / `rollback_stages.js` လိုမျိုး migration approach ကို စဉ်းစားပါ (DB ထဲမှာ old data တွေရှိနေနိုင်လို့)။
- `findByIdAndUpdate` မှာ validation လိုရင် `{ runValidators: true }` သုံးပါ။
- ရှိပြီးသား helper ကို သုံးနိုင်ရင် သုံးပါ — `generateInvoiceNumber` (177)၊ `generateBookingNumber` (187)၊ `generateBookingToken` (197)၊ `createLog` (210)။

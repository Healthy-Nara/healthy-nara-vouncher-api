# Backend — Healthy Nara API (မြန်မာ)

Backend ဆာဗာကို တည်းဖြတ်လုပ်ကိုင်တဲ့အခါ ဒီဖိုင်ကို လမ်းညွှန်အဖြစ် သုံးပါ။

## နည်းပညာ (Stack)

- **Node.js + Express 5** — JavaScript (ESM, `"type": "module"`)
- **MongoDB + Mongoose 9** — MongoDB Atlas
- **JWT** authentication (jsonwebtoken)၊ **bcryptjs** နဲ့ password hashing
- **cors**၊ **morgan** (import လုပ်ထားပေမဲ့ `app.use` နဲ့ မထည့်ထားဘူး — အသုံးမပြုပါ)

## ဖိုင်ဖွဲ့စည်းပုံ (Structure)

- **`index.js`** (~1977 လိုင်း) — route အားလုံး၊ middleware၊ helper၊ server boot တွေအားလုံး **တစ်ဖိုင်တည်းထဲ** ရှိတယ်။ ဒီဖိုင်ကို ပိုင်းဖြာဖို့ (route-splitting) တစ်ခြားဖိုင် မဖန်တီးပါနဲ့ — သေချာတဲ့ တောင်းဆိုမှုရှိမှသာ လုပ်ပါ။
- **`models/`** — Mongoose schema ၁၂ ခု (တစ်ခုချင်း သီးခြားဖိုင်): `User`၊ `Invoice`၊ `CustomerPayment`၊ `CaregiverPayout`၊ `Parent`၊ `Caregiver`၊ `Log`၊ `Lead`၊ `Booking`၊ `DailyReport`၊ `DutyLog`၊ `Customer` (legacy/unused)။
- **Helper scripts** (ထိပ်မှာ `node <script>.js` နဲ့ သီးသန့်ဖွင့်တဲ့): `seed_users.js`၊ `create_new_admins.js`၊ `check_data.js`၊ `clear_users.js`၊ `verify_users.js`၊ `seed_na.js`၊ `migrate_stages.js`။

## အမိန့်များ (Commands) — `backend/` ထဲက ဖွင့်ပါ

| Command | လုပ်ဆောင်ချက် |
|---|---|
| `npm run dev` | Nodemon — `index.js`၊ port `5000` |
| `npm start` | Node `index.js` (production — Vercel အတွက်လည်း ဒါပဲသုံးတယ်) |

Seed/admin scripts (backup သို့မဟုတ် စစ်ဆေးချိန်):

```bash
node seed_users.js         # admin/adminpassword + staff/staffpassword
node create_new_admins.js  # TSO, KMMZ, MKZ admin accounts
node check_data.js         # DB ထဲက အချက်အလက်စစ်ဆေး
node verify_users.js       # existing users စာရင်း
```

## Env files (gitignore လုပ်ထား — commit မလုပ်ပါနဲ့)

`backend/.env` ထဲမှာ:

```
MONGODB_URI=<Atlas SRV>   # database: dev
JWT_SECRET=<signing secret>
PORT=5000
```

Code ထဲ fallback: `MONGODB_URI` → `mongodb://localhost:27017/finance-admin`၊ `PORT` → `5000` (`index.js:165-166`).

## API စည်းမျဉ်းများ (Conventions)

- အားလုံးက response ကို **`sendSuccess` / `sendError`** helper ကနေ `{ success, message, data }` format နဲ့ ပြန်ပေးရမယ် (`index.js:115-121`)။ Frontend interceptor က ဒီ envelope ကို တိုက်ရိုက်ဖြည်ပြီး `data` ကို ပြန်ပေးတယ်။
- Auth: JWT — header `Authorization: Bearer <token>`။ Frontend က `localStorage('token')` မှာ သိမ်းတယ်။
- Invoice ကို `_id` နဲ့မဟုတ်ဘဲ **`invoiceNumber`** (format `INV-YYYYMMDD-XXXX`) နဲ့ ရှာတယ်။ Booking က `bookingNumber` (`BK-YYYYMMDD-####`)၊ bookingToken (public အတွက်) သုံးတယ်။
- Role နှစ်ခု: `admin` (အားလုံးလုပ်လို့ရ)၊ `staff` (invoices ကြည့်/ဖန်တီးလို့ရ)။
- Auth worlds နှစ်ခု: admin/staff (`User`) နဲ့ NA portal (`Caregiver` username/password)။
- Route တိုင်းက try/catch နဲ့ ထုပ်ပြီး error ကို `sendError` ကနေ ပြန်တယ်။ Final error-handling middleware `index.js:1962-1964`။

## လုပ်ဆောင်ချက်အဓိက (Key Flows)

- **NA assign** (`PATCH /api/bookings/:id/assign`) — caregiver availability ကို block လုပ်ပြီး date/child တစ်ခုချင်းစီအတွက် **DailyReport တွေကို auto-create** လုပ်တယ်။
- **Generate invoice** (`POST /api/bookings/:id/generate-invoice`) — platform fee နဲ့အတူ invoice ဖန်တီးပြီး booking နဲ့ ချိတ်တယ်။
- **Convert lead** (`POST /api/leads/:id/convert`) — Parent + Booking ဖန်တီးတယ်။
- **Invoice auto-complete** — `customerPaymentStatus === 'Received'` နဲ့ `caregiverPayoutStatus === 'Paid'` နှစ်ခုလုံးမှန်ရင် invoice က `Completed` ဖြစ်တယ် (`checkAndUpdateInvoiceCompletion`၊ `index.js:201`).

## Deployment (Vercel)

- `vercel.json` — builder `@vercel/node`၊ entry `index.js`၊ catch-all `/(.*)` → `index.js`။ ဒါကြောင့် `index.js` အဆုံးမှာ `export default app` ရှိရတယ်။
- Server က **အမြဲ** `listen` လုပ်တယ် (`0.0.0.0:PORT`) — Railway fix (commit `25e9eea`) ကြောင့် `NODE_ENV !== 'production'` guard ကို ဖယ်ထားတယ်။
- Mongo connect fail ဖြစ်ရင် **`process.exit(1)` မခေါ်တော့ဘူး** — error ကို log လုပ်ပြီး server က ဆက်အလုပ်လုပ်တယ် (graceful degradation)။

## Rules (ထပ်ဆင့် စည်းမျဉ်းများ)

- [`backend/.claude/rules/`](.claude/rules/) ထဲက rule ဖိုင်တွေကိုလည်း လိုက်နာပါ — သင့်ကုဒ်တွေ ဒီ API စည်းမျဉ်းနဲ့ ကိုက်ညီအောင် သေချာစစ်ပါ။

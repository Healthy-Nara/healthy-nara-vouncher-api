# Auth & Middleware — စည်းမျဉ်း (Rule)

Route အသစ် ထည့်တဲ့အခါ ဘယ် middleware ကို သုံးရမယ်ဆိုတာ ဒီကစစ်ပါ။

## Middleware သုံးမျိုး (`index.js:42-91`)

1. **`authMiddleware`** (42-67) — JWT ကို verify လုပ်ပြီး user ကို load လုပ်တယ်။ `User.findById` နဲ့ စကြည့်တယ်။ **User မတွေ့ရင် `Caregiver.findById` ကို fallback** လုပ်ပြီး role `staff` နဲ့ `req.user` ထဲ ထည့်တယ်။ → NA token တွေလည်း staff-guarded route တွေကို ဝင်လို့ရတယ်။
2. **`roleMiddleware(roles)`** (69-74) — `req.user.role` က allow list ထဲမှာမရှိရင် 403 ပြန်တယ်။ သုံးပုံ:
   - `roleMiddleware(['admin'])` — admin ပဲ
   - `roleMiddleware(['admin','staff'])` — admin + staff
3. **`naAuthMiddleware`** (77-91) — NA portal အတွက် သီးသန့်။ JWT verify → `Caregiver` နဲ့ ကိုက်တာရှိရမယ်၊ `req.caregiver` ထဲ ထည့်တယ်။ Role gating မရှိဘူး။

## ဘယ်အခါ ဘာသုံးမလဲ (Which to use)

| Route အမျိုး | Middleware |
|---|---|
| Admin/staff UI routes | `authMiddleware` (+ `roleMiddleware` ချချင်) |
| NA portal routes (`/api/na/*`) | `naAuthMiddleware` |
| Admin NA oversight (`/api/admin/*`) | `authMiddleware` + `roleMiddleware(['admin'])` |
| Public token-in-URL (auth header မလို) | **မသုံးဘူး** — token က URL path ထဲမှာ |

## Public token-in-URL endpoints (auth မလို)

- `/api/bookings/public/:token` — parent self-service (children CRUD၊ details၊ select NA)
- `/api/family/:token/reports` — family report viewing

ဒီ route တွေမှာ `Authorization` header မလိုဘူး — token က path ထဲကပဲ ပါတယ်။

## သတိထားစရာ (Caveats)

- `authMiddleware` က NA token ကို `staff` အဖြစ် လက်ခံတယ် — admin-only route တွေမှာ `roleMiddleware(['admin'])` ထပ်ထည့်ပါ။
- JWT secret တစ်ခုတည်းကို admin နဲ့ NA token နှစ်မျိုးလုံး သုံးတယ်။
- NA token expiry က 7d၊ admin token က 1d။

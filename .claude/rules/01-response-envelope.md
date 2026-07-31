# Response Envelope — စည်းမျဉ်း (Rule)

Backend route ကနေ ပြန်တဲ့ response အားလုံးက ဒီ format နဲ့ပဲ ဖြစ်ရမယ်။

## Format

```js
// Success — index.js:115
sendSuccess(res, message, data);

// Error — index.js:119
sendError(res, message, statusCode, details);
```

ထွက်ပေါ်လာတဲ့ shape က:

```json
{ "success": true, "message": "...", "data": {...} }
```

## အဘယ်ကြောင့်နည်း (Why)

Frontend ရဲ့ `src/api/index.ts` response interceptor (lines 19-32) က ဒီ envelope ကို ဖြည်ပြီး `data` ကို တိုက်ရိုက် return လုပ်တယ်။ Error ဖြစ်ရင် `error.response.data.message` ကို `error.message` ပေါ်ကို copy လုပ်တယ်။ ဒါကြောင့်:

- **`sendSuccess` / `sendError` ကို ဖြတ်သွားဖို့** — ပုံစံမတူတဲ့ response (`res.json({...})` တို့) ရေးရင် frontend က ဖတ်လို့မရဘူး။
- **Error မှန်သမျှ `sendError` ကနေ** ပြန်ပါ — frontend က `error.message` ကို UI မှာ ပြဖို့ သုံးတယ်။
- `message` ကို user-readable ဖြစ်အောင် ရေးပါ။

## Example

```js
// အောင်မြင်ချိန်
sendSuccess(res, 'Lead created', { lead });

// error
sendError(res, 'Lead not found', 404);
```

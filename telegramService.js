import { Ticket } from './models/Ticket.js';

// Stateless Telegram Bot API client using the global fetch (works on Vercel serverless).
// If TELEGRAM_BOT_TOKEN is not set, every function is a safe no-op so the app still boots.

const STATUS_BUTTONS = [
  { text: '🟡 In Progress', status: 'In Progress' },
  { text: '⏸ Pending', status: 'Pending' },
  { text: '✅ Resolved', status: 'Resolved' }
];

async function callTelegram(method, payload) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return await res.json();
  } catch (err) {
    console.error('>>> TELEGRAM API ERROR:', err.message);
    return null;
  }
}

function buildKeyboard(ticketId, currentStatus) {
  return {
    inline_keyboard: STATUS_BUTTONS
      .filter((b) => b.status !== currentStatus)
      .map((b) => [
        { text: b.text, callback_data: `ticket:${ticketId}:${b.status}` }
      ])
  };
}

export async function notifyTicketAssigned(ticketId) {
  if (!process.env.TELEGRAM_BOT_TOKEN) return;
  const ticket = await Ticket.findById(ticketId)
    .populate('assigned_to', 'telegramChatId username')
    .populate('created_by', 'telegramChatId username');
  if (!ticket || !ticket.assigned_to) return;

  const chatId = ticket.assigned_to.telegramChatId;
  if (!chatId) return;

  const text =
    `🎫 *New Ticket Assigned*\n\n` +
    `*${ticket.title}*\n` +
    `${ticket.description || ''}\n\n` +
    `Priority: ${ticket.priority}\n` +
    `Status: ${ticket.status}\n\n` +
    `အောက်မှာ button တစ်ခုခုနှိပ်ပြီး status ပြောင်းနိုင်ပါတယ်`;

  await callTelegram('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'Markdown',
    reply_markup: buildKeyboard(ticketId, ticket.status)
  });
}

export async function processTicketCallback(callbackQuery) {
  const data = callbackQuery.data || '';
  if (!data.startsWith('ticket:')) return;

  const rest = data.slice('ticket:'.length);
  const colon = rest.indexOf(':');
  if (colon < 0) return;
  const ticketId = rest.slice(0, colon);
  const newStatus = rest.slice(colon + 1);

  const ticket = await Ticket.findById(ticketId).populate('created_by', 'telegramChatId username');
  if (!ticket) return;

  if (['Open', 'In Progress', 'Pending', 'Resolved'].includes(newStatus) && newStatus !== ticket.status) {
    ticket.status = newStatus;
    await ticket.save();
  }

  // Acknowledge the button press
  await callTelegram('answerCallbackQuery', {
    callback_query_id: callbackQuery.id,
    text: `Status updated to ${ticket.status}`
  });

  // Refresh the original message
  const msg = callbackQuery.message;
  if (msg && msg.chat && msg.message_id) {
    await callTelegram('editMessageText', {
      chat_id: msg.chat.id,
      message_id: msg.message_id,
      text: `🎫 *${ticket.title}*\n\nStatus: ${ticket.status}`,
      parse_mode: 'Markdown',
      reply_markup: buildKeyboard(ticketId, ticket.status)
    });
  }

  // Notify the ticket creator (unless they are the assignee who just changed it)
  const creator = ticket.created_by;
  if (creator && creator.telegramChatId && !(ticket.assigned_to && ticket.assigned_to.toString() === creator._id.toString())) {
    await callTelegram('sendMessage', {
      chat_id: creator.telegramChatId,
      text: `🔄 Ticket status ပြောင်းသွားပါပြီ: *${ticket.title}* → ${ticket.status}`,
      parse_mode: 'Markdown'
    });
  }
}

export async function initTelegramWebhook() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const url = process.env.TELEGRAM_WEBHOOK_URL;
  if (!token || !url) return;
  await callTelegram('setWebhook', { url });
}

import { Ticket } from './models/Ticket.js';
import { TicketComment } from './models/TicketComment.js';
import { TicketHistory } from './models/TicketHistory.js';
import { User } from './models/User.js';

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

// Register a sent Telegram message (chatId + messageId) on the ticket so replying
// to that message can be mapped back to the ticket and stored as a comment.
async function registerTelegramLink(ticketId, chatId, messageId) {
  if (chatId == null || messageId == null) return;
  await Ticket.updateOne(
    { _id: ticketId },
    { $push: { telegramNotifications: { chatId: String(chatId), messageId: Number(messageId) } } }
  );
}

// Shared full message so editing a status keeps the title/description/priority visible
function formatTicketMessage(ticket) {
  return (
    `🎫 *${ticket.title}*\n` +
    `${ticket.description || ''}` +
    `\n\nPriority: ${ticket.priority}\n` +
    `Status: ${ticket.status}\n\n` +
    `အောက်မှာ button တစ်ခုခုနှိပ်ပြီး status ပြောင်းနိုင်ပါတယ်`
  );
}

export async function notifyTicketAssigned(ticketId) {
  if (!process.env.TELEGRAM_BOT_TOKEN) return;
  const ticket = await Ticket.findById(ticketId)
    .populate('assigned_to', 'telegramChatId username')
    .populate('created_by', 'telegramChatId username');
  if (!ticket || !ticket.assigned_to) return;

  const chatId = ticket.assigned_to.telegramChatId;
  if (!chatId) return;

  const result = await callTelegram('sendMessage', {
    chat_id: chatId,
    text: formatTicketMessage(ticket),
    parse_mode: 'Markdown',
    reply_markup: buildKeyboard(ticketId, ticket.status)
  });

  // Remember the sent message so replies to it can be mapped back to this ticket
  if (result && result.ok && result.result) {
    await registerTelegramLink(ticket._id, chatId, result.result.message_id);
  }
}

export async function notifyTicketCommented(ticketId, commenterName, message) {
  if (!process.env.TELEGRAM_BOT_TOKEN) return;
  const ticket = await Ticket.findById(ticketId)
    .populate('assigned_to', 'telegramChatId username')
    .populate('created_by', 'telegramChatId username');
  if (!ticket) return;

  const text =
    `💬 *New comment on ${ticket.title}*\n\n` +
    `*${commenterName}:* ${message}\n\n` +
    `Status: ${ticket.status}`;

  const recipients = [ticket.assigned_to, ticket.created_by]
    .filter(Boolean)
    // Don't notify the person who wrote the comment
    .filter((u) => u.username !== commenterName)
    // Deduplicate (assignee may be the creator)
    .filter((u, i, arr) => arr.findIndex((x) => x._id.toString() === u._id.toString()) === i);

  for (const recipient of recipients) {
    if (!recipient.telegramChatId) continue;
    const result = await callTelegram('sendMessage', {
      chat_id: recipient.telegramChatId,
      text,
      parse_mode: 'Markdown'
    });
    // Also make this comment message reply-linkable
    if (result && result.ok && result.result) {
      await registerTelegramLink(ticket._id, recipient.telegramChatId, result.result.message_id);
    }
  }
}

// Handle a plain-text message that is a reply to a ticket notification message.
// Resolves the linked ticket via telegramNotifications and stores the text as a comment.
export async function processIncomingMessage(message) {
  if (!message || !message.text || !message.reply_to_message) return;

  const chatId = message.chat && message.chat.id;
  const replyMessageId = message.reply_to_message.message_id;
  if (chatId == null || replyMessageId == null) return;

  const ticket = await Ticket.findOne({
    'telegramNotifications.chatId': String(chatId),
    'telegramNotifications.messageId': Number(replyMessageId)
  });
  if (!ticket) return; // not a reply to a ticket notification

  const fromId = message.from && message.from.id;
  const user = await User.findOne({ telegramChatId: String(fromId) });
  if (!user) {
    await callTelegram('sendMessage', {
      chat_id: chatId,
      text: '⚠️ သင့် Telegram ID ကို Accounts page မှာ မသတ်မှတ်ရသေးပါ — comment ထည့်နိုင်ဖို့ admin က သတ်မှတ်ပေးရပါမယ်။'
    });
    return;
  }

  await TicketComment.create({
    ticket_id: ticket._id,
    user_id: user._id,
    userName: user.username,
    message: message.text
  });
  await TicketHistory.create({
    ticket_id: ticket._id,
    user_id: user._id,
    userName: user.username,
    action_performed: 'Added comment'
  });

  await callTelegram('sendMessage', { chat_id: chatId, text: '✅ Comment ထည့်ပြီးပါပြီ' });
  await notifyTicketCommented(ticket._id, user.username, message.text);
}

export async function processTicketCallback(callbackQuery) {
  const data = callbackQuery.data || '';
  console.log('>>> [Telegram Callback Query]:', data, 'from:', callbackQuery.from?.username || callbackQuery.from?.id);
  if (!data.startsWith('ticket:')) return;

  const rest = data.slice('ticket:'.length);
  const colon = rest.indexOf(':');
  if (colon < 0) return;
  const ticketId = rest.slice(0, colon);
  const newStatus = rest.slice(colon + 1);

  const ticket = await Ticket.findById(ticketId).populate('created_by', 'telegramChatId username');
  if (!ticket) {
    console.log('>>> [Telegram Callback] Ticket not found:', ticketId);
    return;
  }

  if (['Open', 'In Progress', 'Pending', 'Resolved'].includes(newStatus) && newStatus !== ticket.status) {
    const oldStatus = ticket.status;
    ticket.status = newStatus;
    await ticket.save();

    console.log(`>>> [Telegram] Ticket "${ticket.title}" status updated: ${oldStatus} -> ${newStatus}`);

    // Record ticket history
    const user = await User.findOne({ telegramChatId: String(callbackQuery.from?.id) });
    await TicketHistory.create({
      ticket_id: ticket._id,
      user_id: user ? user._id : (ticket.assigned_to || ticket.created_by),
      userName: user ? user.username : (callbackQuery.from?.first_name || 'Telegram User'),
      action_performed: `Changed status from ${oldStatus} to ${newStatus} (via Telegram)`
    });
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
      text: formatTicketMessage(ticket),
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

export async function getTelegramWebhookStatus() {
  return await callTelegram('getWebhookInfo', {});
}

export async function initTelegramWebhook(customUrl) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const url = customUrl || process.env.TELEGRAM_WEBHOOK_URL;
  if (!token || !url) return null;
  const res = await callTelegram('setWebhook', { url });
  console.log(`>>> [Telegram Webhook Setup Result]: ${url} ->`, res);
  return res;
}

let isPollingActive = false;

export async function startTelegramPolling() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || isPollingActive) return;
  isPollingActive = true;

  try {
    // Only delete webhook if explicit polling was forced by developer
    await callTelegram('deleteWebhook', { drop_pending_updates: false });
    console.log('>>> [Telegram] Explicit Polling Mode: Webhook deleted. Long-polling started.');

    let offset = 0;

    const poll = async () => {
      while (isPollingActive) {
        try {
          const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=20`, {
            method: 'GET'
          });
          const data = await res.json();
          if (data && data.ok && Array.isArray(data.result)) {
            for (const update of data.result) {
              offset = update.update_id + 1;
              if (update.callback_query) {
                await processTicketCallback(update.callback_query);
              }
              if (update.message) {
                await processIncomingMessage(update.message);
              }
            }
          }
        } catch (err) {
          // Wait briefly before retrying if network error
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }
      }
    };

    poll();
  } catch (err) {
    console.error('>>> [Telegram Polling Error]:', err.message);
  }
}

export async function initTelegramService() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.log('>>> [Telegram] No TELEGRAM_BOT_TOKEN provided. Skipping Telegram service.');
    return;
  }

  const isPollingForced = process.env.TELEGRAM_USE_POLLING === 'true';
  const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL;
  const hasWebhookUrl = webhookUrl && webhookUrl.startsWith('https://');

  if (hasWebhookUrl && !isPollingForced) {
    // If webhook URL is provided, always register webhook (regardless of NODE_ENV)
    await initTelegramWebhook();
  } else if (isPollingForced) {
    await startTelegramPolling();
  } else {
    console.log('>>> [Telegram] Running locally without webhook URL. Preserving live Telegram webhook.');
  }
}

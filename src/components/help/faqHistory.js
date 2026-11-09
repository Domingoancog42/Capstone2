export const FAQ_HISTORY_LIMIT = 10;

export function faqHistoryKey(userId) {
  return userId == null || String(userId).trim() === "" ? null : `hris_faq_history:v1:${userId}`;
}

function normalizeConversation(chat) {
  if (!chat || typeof chat.id !== "string" || !chat.id || chat.id.length > 160
    || !Number.isFinite(Date.parse(chat.updatedAt)) || !Array.isArray(chat.messages)
    || !chat.messages.length || chat.messages.length % 2 !== 0) return null;

  const messages = [];
  for (const [index, message] of chat.messages.entries()) {
    const role = index % 2 === 0 ? "user" : "assistant";
    if (!message || message.role !== role || typeof message.content !== "string"
      || !message.content.trim() || message.content.length > (role === "user" ? 2000 : 8000)) return null;
    messages.push({
      role, content: message.content,
      ...(role === "assistant" ? {
        source: message.source === "guide" ? "guide" : "ai",
        notice: typeof message.notice === "string" ? message.notice.slice(0, 2000) : "",
        references: Array.isArray(message.references) ? message.references.filter((reference) => (
          reference && typeof reference.id === "string" && typeof reference.title === "string"
        )).slice(0, 10).map(({ id, title }) => ({ id: id.slice(0, 160), title: title.slice(0, 300) })) : [],
      } : {}),
    });
  }
  return {
    id: chat.id,
    title: messages[0].content.replace(/\s+/g, " ").slice(0, 80),
    updatedAt: new Date(chat.updatedAt).toISOString(),
    messages,
  };
}

export function loadFaqHistory(userId) {
  const empty = { activeId: null, conversations: [] };
  const key = faqHistoryKey(userId);
  if (!key) return empty;
  try {
    const stored = JSON.parse(window.localStorage.getItem(key));
    if (!stored || !Array.isArray(stored.conversations)) return empty;
    const seen = new Set();
    const conversations = stored.conversations.map(normalizeConversation).filter((chat) => {
      if (!chat || seen.has(chat.id)) return false;
      seen.add(chat.id);
      return true;
    }).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, FAQ_HISTORY_LIMIT);
    return { conversations, activeId: conversations.some((chat) => chat.id === stored.activeId) ? stored.activeId : null };
  } catch {
    return empty;
  }
}

export function saveFaqHistory(userId, history) {
  const key = faqHistoryKey(userId);
  if (!key) return true;
  try {
    window.localStorage.setItem(key, JSON.stringify(history));
    return true;
  } catch {
    return false;
  }
}

export function updateFaqHistory(history, messages) {
  const id = history.activeId || window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const conversation = {
    id, title: messages[0].content.replace(/\s+/g, " ").slice(0, 80),
    updatedAt: new Date().toISOString(), messages,
  };
  return {
    activeId: id,
    conversations: [conversation, ...history.conversations.filter((chat) => chat.id !== id)].slice(0, FAQ_HISTORY_LIMIT),
  };
}

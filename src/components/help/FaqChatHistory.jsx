import React from "react";
import { History, MessageCircle, Plus, Trash2 } from "lucide-react";
import { FAQ_HISTORY_LIMIT } from "./faqHistory";

export default function FaqChatHistory({ conversations, activeId, notice, onOpen, onDelete, onNewChat }) {
  return <section id="faq-history-panel" className="faq-history" aria-labelledby="faq-history-heading">
    <div className="faq-history__heading"><div><h3 id="faq-history-heading"><History size={19} aria-hidden="true" />Recent chats</h3><p>Your {FAQ_HISTORY_LIMIT} most recent chats, saved in this browser.</p></div><span className="faq-history__count">{conversations.length}</span></div>
    {notice ? <p className="faq-history__notice" role="status">{notice}</p> : null}
    {conversations.length ? <ul className="faq-history__list">{conversations.map((chat) => <li key={chat.id} className={`faq-history__item${chat.id === activeId ? " faq-history__item--active" : ""}`}>
      <button type="button" className="faq-history__open" aria-label={`Open chat: ${chat.title}`} aria-current={chat.id === activeId ? "true" : undefined} onClick={() => onOpen(chat)}>
        <MessageCircle size={19} aria-hidden="true" /><span><strong>{chat.title}</strong><span><time dateTime={chat.updatedAt}>{new Date(chat.updatedAt).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}</time><span aria-hidden="true"> · </span>{chat.messages.length / 2} {chat.messages.length === 2 ? "answer" : "answers"}</span></span>
      </button>
      <button type="button" className="faq-history__delete" aria-label={`Delete chat: ${chat.title}`} title="Delete chat" onClick={() => onDelete(chat.id)}><Trash2 size={17} aria-hidden="true" /></button>
    </li>)}</ul> : <div className="faq-history__empty"><MessageCircle size={34} aria-hidden="true" /><h3>No saved chats yet</h3><p>Ask a question to start your first conversation.</p><button type="button" onClick={onNewChat}><Plus size={17} aria-hidden="true" />New chat</button></div>}
  </section>;
}

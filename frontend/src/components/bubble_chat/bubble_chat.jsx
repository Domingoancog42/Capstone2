import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Filter,
  MessageCircle,
  MessageSquareText,
  MoreHorizontal,
  Plus,
  Search,
  Send,
  Paperclip,
  Smile,
  ShieldAlert,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { getChat, sendChatMessage } from "../../services/api";
import { resolveBackendAssetUrl } from "../../utils/backendAssetUrl";

function initialsFor(name = "") {
  return String(name || "User")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("") || "U";
}

function formatContactTime(value) {
  const date = new Date(String(value || "").replace(" ", "T"));

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();

  if (sameDay) {
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(date);
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
  }).format(date);
}

function formatMessageTime(value) {
  const date = new Date(String(value || "").replace(" ", "T"));

  return Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }).format(date);
}

function Avatar({ contact, size = "md" }) {
  const imageUrl = resolveBackendAssetUrl(contact?.profileImage);
  const sizeClass = size === "lg" ? "h-12 w-12 text-base" : "h-10 w-10 text-sm";
  const name = contact?.name || contact?.username || "User";

  return (
    <div className="relative shrink-0">
      <div className={`${sizeClass} grid place-items-center overflow-hidden rounded-full border border-slate-100 bg-gradient-to-br from-slate-100 to-slate-200 font-semibold text-slate-600 shadow-sm`}>
        {imageUrl ? (
          <img src={imageUrl} alt={name} className="h-full w-full object-cover" />
        ) : (
          <span>{initialsFor(name)}</span>
        )}
      </div>
      <span className="absolute bottom-0 right-0 block h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-white" />
    </div>
  );
}

function EmptyConversation({ contacts, onStart }) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-slate-50/50 px-6 py-12 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-red-50 text-[#D61E1E] shadow-sm mb-6">
        <MessageCircle size={36} />
      </div>
      <h2 className="m-0 max-w-[360px] text-2xl font-bold leading-tight text-slate-900">
        Professional Messages
      </h2>
      <p className="mt-2 max-w-[320px] text-sm text-slate-500 leading-relaxed">
        Connect and communicate with Mines and Geosciences Bureau members. Select a contact from the list or start a new chat.
      </p>
      <button 
        disabled={!contacts.length}
        onClick={onStart}
        className="mt-6 inline-flex min-h-11 items-center justify-center rounded-2xl bg-[#D61E1E] px-6 text-sm font-semibold text-white transition hover:bg-[#991B1B] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 shadow-sm"
      >
        Start Messaging
      </button>
    </div>
  );
}

export default function BubbleChat({ user }) {
  const [contacts, setContacts] = useState([]);
  const [messages, setMessages] = useState([]);
  const [activeContact, setActiveContact] = useState(null);
  const [selectedContactId, setSelectedContactId] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const messagesEndRef = useRef(null);

  const loadChat = useCallback(async (contactId = selectedContactId) => {
    try {
      const result = await getChat(contactId);
      const nextContacts = result.contacts || [];

      setContacts(nextContacts);
      setMessages(result.messages || []);
      setActiveContact(result.activeContact || nextContacts.find((contact) => String(contact.id) === String(contactId)) || null);
      setError("");
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Unable to load messages.");
    } finally {
      setLoading(false);
    }
  }, [selectedContactId]);

  useEffect(() => {
    setLoading(true);
    loadChat();
  }, [loadChat]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      loadChat();
    }, 10000);

    return () => window.clearInterval(intervalId);
  }, [loadChat]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, selectedContactId]);

  const filteredContacts = useMemo(() => {
    const search = searchQuery.trim().toLowerCase();

    return contacts.filter((contact) => {
      const matchesSearch = !search || [
        contact.name,
        contact.username,
        contact.email,
        contact.role,
        contact.lastMessage,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(search));
      const matchesUnread = !unreadOnly || Number(contact.unreadCount || 0) > 0;

      return matchesSearch && matchesUnread;
    });
  }, [contacts, searchQuery, unreadOnly]);

  const handleSelectContact = (contact) => {
    setSelectedContactId(contact.id);
    setActiveContact(contact);
    setMessages([]);
  };

  const handleStartMessage = () => {
    const firstContact = filteredContacts[0] || contacts[0];

    if (firstContact) {
      handleSelectContact(firstContact);
    }
  };

  const handleSendMessage = async (event) => {
    if (event) {
      event.preventDefault();
    }

    const messageText = draft.trim();
    const receiverId = activeContact?.id || selectedContactId;

    if (!receiverId || messageText === "") {
      return;
    }

    setSending(true);
    try {
      const result = await sendChatMessage(receiverId, messageText);
      setDraft("");
      setContacts(result.contacts || []);
      setMessages(result.messages || []);
      setActiveContact(result.activeContact || activeContact);
      setError("");
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Unable to send message.");
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="min-h-0 flex-1 overflow-hidden rounded-[26px] border border-slate-200 bg-white shadow-sm">
      <div className="grid h-full grid-cols-1 lg:grid-cols-[350px_minmax(0,1fr)]">
        
        {/* Left Side: Contact List */}
        <aside className="flex min-h-0 flex-col border-r border-slate-200 bg-slate-50/30">
          <div className="flex min-h-16 items-center justify-between border-b border-slate-100 px-5 bg-white">
            <h1 className="m-0 text-base font-bold text-slate-900">Conversations</h1>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                className="grid h-8 w-8 place-items-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
                aria-label="Start message"
                onClick={handleStartMessage}
              >
                <Plus size={18} />
              </button>
              <button
                type="button"
                className="grid h-8 w-8 place-items-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
                aria-label="More options"
              >
                <MoreHorizontal size={18} />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3 bg-white">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search conversations..."
                className="h-9 w-full rounded-2xl border border-slate-200 bg-slate-50/50 pl-9 pr-3 text-xs text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-[#D61E1E] focus:bg-white focus:ring-2 focus:ring-[#D61E1E]/10"
                aria-label="Search messages"
              />
            </div>
            <button
              type="button"
              className={`grid h-9 w-9 place-items-center rounded-2xl border transition ${
                unreadOnly
                  ? "bg-red-50 border-red-100 text-[#D61E1E]"
                  : "bg-white border-slate-200 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
              }`}
              aria-label="Show unread messages"
              onClick={() => setUnreadOnly((current) => !current)}
            >
              <Filter size={15} />
            </button>
          </div>

          {error ? (
            <div className="m-3 flex items-start gap-2.5 rounded-2xl border border-rose-100 bg-rose-50/80 px-4 py-3 text-xs text-rose-800">
              <ShieldAlert size={16} className="shrink-0 text-rose-600 mt-0.5" />
              <p className="m-0 font-medium leading-relaxed">{error}</p>
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-y-auto py-2">
            {loading ? (
              <div className="flex flex-col gap-2 px-4 py-5">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div key={index} className="flex items-center gap-3 animate-pulse">
                    <div className="h-10 w-10 rounded-full bg-slate-200" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3 w-2/5 rounded bg-slate-200" />
                      <div className="h-2.5 w-4/5 rounded bg-slate-200" />
                    </div>
                  </div>
                ))}
              </div>
            ) : filteredContacts.length > 0 ? (
              <div className="px-2 space-y-1">
                {filteredContacts.map((contact) => {
                  const active = String(contact.id) === String(activeContact?.id || selectedContactId);
                  const unreadCount = Number(contact.unreadCount || 0);

                  return (
                    <button
                      type="button"
                      key={contact.id}
                      onClick={() => handleSelectContact(contact)}
                      className={`grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-3 py-3 rounded-2xl text-left transition-all duration-200 ${
                        active
                          ? "bg-red-50/60 border-l-4 border-[#D61E1E] shadow-sm"
                          : "hover:bg-slate-100/50"
                      }`}
                    >
                      <Avatar contact={contact} />
                      <span className="min-w-0">
                        <span className={`block truncate text-xs font-semibold ${active ? "text-[#D61E1E]" : "text-slate-900"}`}>
                          {contact.name || contact.username || "User"}
                        </span>
                        <span className="mt-1 block truncate text-[11px] text-slate-500 font-medium">
                          {contact.lastMessage || contact.role || "No messages yet"}
                        </span>
                      </span>
                      <span className="flex flex-col items-end gap-1.5 shrink-0">
                        <span className="text-[10px] font-medium text-slate-400">
                          {formatContactTime(contact.lastMessageAt)}
                        </span>
                        {unreadCount > 0 ? (
                          <span className="grid h-4.5 min-w-4.5 place-items-center rounded-full bg-[#D61E1E] px-1.5 text-[9px] font-bold text-white shadow-sm">
                            {unreadCount > 9 ? "9+" : unreadCount}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="m-0 px-5 py-6 text-xs text-slate-500 font-medium text-center">No messages found.</p>
            )}
          </div>
        </aside>

        {/* Right Side: Chat Window */}
        <div className="flex min-h-0 flex-col bg-white">
          {activeContact ? (
            <>
              <header className="flex min-h-16 items-center justify-between border-b border-slate-200 px-5 bg-white shadow-sm/5 z-10">
                <div className="flex items-center gap-3">
                  <Avatar contact={activeContact} size="lg" />
                  <div className="min-w-0">
                    <h2 className="m-0 truncate text-sm font-bold text-slate-900">
                      {activeContact.name || activeContact.username || "User"}
                    </h2>
                    <p className="m-0 mt-0.5 truncate text-[11px] text-slate-500 font-medium">
                      {[activeContact.role, activeContact.division].filter(Boolean).join(" • ") || activeContact.email}
                    </p>
                  </div>
                </div>
              </header>

              <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/50 px-5 py-5 space-y-4">
                {messages.length > 0 ? (
                  <div className="flex flex-col gap-3">
                    <AnimatePresence initial={false}>
                      {messages.map((message) => (
                        <motion.div
                          key={message.id}
                          initial={{ opacity: 0, y: 10, scale: 0.95 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          transition={{ duration: 0.2 }}
                          className={`flex ${message.mine ? "justify-end" : "justify-start"}`}
                        >
                          <div
                            className={`max-w-[70%] rounded-2xl px-4 py-2.5 shadow-sm/10 ${
                              message.mine
                                ? "rounded-br-sm bg-[#D61E1E] text-white"
                                : "rounded-bl-sm border border-slate-200 bg-white text-slate-800"
                            }`}
                          >
                            <p className="m-0 whitespace-pre-wrap text-xs leading-relaxed font-medium">{message.messageText}</p>
                            <span className={`block text-[9px] mt-1.5 text-right font-medium ${message.mine ? "text-red-200/90" : "text-slate-400"}`}>
                              {formatMessageTime(message.createdAt)}
                            </span>
                          </div>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                    <span ref={messagesEndRef} />
                  </div>
                ) : (
                  <div className="flex h-full flex-col items-center justify-center text-center text-sm text-slate-500 py-10">
                    <div className="h-10 w-10 rounded-full bg-slate-100 grid place-items-center text-slate-400 mb-3">
                      <MessageSquareText size={20} />
                    </div>
                    <p className="m-0 font-semibold text-slate-700 text-xs">No conversation history yet</p>
                    <p className="m-0 text-[11px] text-slate-400 mt-1">Start the conversation by typing a message below.</p>
                  </div>
                )}
              </div>

              {/* Message Input Box */}
              <form onSubmit={handleSendMessage} className="border-t border-slate-200 bg-white p-4">
                <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50/50 p-2 focus-within:border-[#D61E1E] focus-within:ring-2 focus-within:ring-[#D61E1E]/10 transition">
                  <button
                    type="button"
                    className="grid h-9 w-9 place-items-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
                    aria-label="Add attachment"
                  >
                    <Paperclip size={18} />
                  </button>
                  <textarea
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder={`Message ${activeContact.name || activeContact.username || "user"}...`}
                    rows={1}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        if (draft.trim() && !sending) {
                          handleSendMessage(e);
                        }
                      }
                    }}
                    className="flex-1 bg-transparent px-2 py-1.5 text-xs text-slate-800 placeholder:text-slate-400 outline-none resize-none min-h-[38px] max-h-24 [scrollbar-width:thin]"
                  />
                  <button
                    type="button"
                    className="grid h-9 w-9 place-items-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
                    aria-label="Insert emoji"
                  >
                    <Smile size={18} />
                  </button>
                  <button
                    type="submit"
                    disabled={sending || !draft.trim()}
                    className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#D61E1E] text-white hover:bg-[#991B1B] disabled:bg-slate-200 disabled:text-slate-400 transition"
                  >
                    <Send size={15} />
                  </button>
                </div>
              </form>
            </>
          ) : (
            <EmptyConversation contacts={contacts} onStart={handleStartMessage} />
          )}
        </div>
      </div>
    </section>
  );
}

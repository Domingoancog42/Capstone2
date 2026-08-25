import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  Loader2,
  MessageSquareText,
  Search,
  Send,
  ShieldAlert,
} from "lucide-react";
import { getChat, sendChatMessage } from "../../services/api";
import NotificationBadge from "../UI/NotificationBadge";
import { Avatar, formatContactTime, formatMessageTime, isContactOnline } from "./chatPresentation";

/*
 * How often the popover re-reads chat.php. Closed, it is only keeping the unread badge honest, so it
 * polls on the same 30s the notification bell uses. Open, it is a conversation someone is watching,
 * and matches the 10s the full Communications workspace runs at.
 */
const CHAT_POLL_INTERVAL_OPEN_MS = 10000;
const CHAT_POLL_INTERVAL_CLOSED_MS = 30000;

/**
 * The message icon in the top bar and the card it opens.
 *
 * A sibling of the Communications workspace rather than a replacement for it: the workspace is where
 * a long conversation is read, this is for answering one without leaving the page you are on. Both
 * talk to chat.php, so a thread read here is read there.
 *
 * The card has two views because it is only ~380px wide -- the workspace's side-by-side list and
 * thread do not fit, so picking a contact replaces the list and the back arrow returns to it.
 */
export default function ChatBubbleButton({ user, onOpen }) {
  const rootRef = useRef(null);
  const mountedRef = useRef(false);
  const messagesEndRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState("list");
  const [contacts, setContacts] = useState([]);
  const [messages, setMessages] = useState([]);
  const [activeContact, setActiveContact] = useState(null);
  const [selectedContactId, setSelectedContactId] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [threadLoading, setThreadLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);

  /*
   * `contactId` is what separates the two calls this component makes. Passing one asks chat.php for
   * that thread, which also marks it read; passing nothing returns the contact list alone and
   * changes nothing. The badge poll must therefore never pass an id, or leaving the tab open would
   * quietly clear unread messages nobody had looked at.
   */
  const loadChat = useCallback(async ({ contactId = "", silent = false } = {}) => {
    if (!silent) {
      setLoading(true);
    }

    try {
      const result = await getChat(contactId);

      if (!mountedRef.current) {
        return;
      }

      setContacts(Array.isArray(result.contacts) ? result.contacts : []);

      if (contactId) {
        setMessages(Array.isArray(result.messages) ? result.messages : []);
        setActiveContact((current) => result.activeContact || current);
      }

      setError("");
    } catch (requestError) {
      if (mountedRef.current) {
        setError(requestError.response?.data?.message || "Unable to load messages.");
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        setThreadLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadChat({ silent: true });
  }, [loadChat, user?.id]);

  useEffect(() => {
    const intervalId = window.setInterval(
      () => {
        void loadChat({
          contactId: open && view === "thread" ? selectedContactId : "",
          silent: true,
        });
      },
      open ? CHAT_POLL_INTERVAL_OPEN_MS : CHAT_POLL_INTERVAL_CLOSED_MS
    );

    return () => window.clearInterval(intervalId);
  }, [loadChat, open, selectedContactId, view]);

  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("touchstart", handleOutsideClick);

    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("touchstart", handleOutsideClick);
    };
  }, []);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handleEscape = (event) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("keydown", handleEscape);

    return () => document.removeEventListener("keydown", handleEscape);
  }, [open]);

  useEffect(() => {
    if (open && view === "thread") {
      messagesEndRef.current?.scrollIntoView({ block: "end" });
    }
  }, [messages.length, open, view]);

  const totalUnread = useMemo(
    () => contacts.reduce((total, contact) => total + (Number(contact.unreadCount) || 0), 0),
    [contacts]
  );

  const filteredContacts = useMemo(() => {
    const search = searchQuery.trim().toLowerCase();

    if (!search) {
      return contacts;
    }

    return contacts.filter((contact) =>
      [contact.name, contact.username, contact.email, contact.role, contact.lastMessage]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(search))
    );
  }, [contacts, searchQuery]);

  const handleToggle = () => {
    if (open) {
      setOpen(false);
      return;
    }

    onOpen?.();
    setOpen(true);
    // Only draw the skeleton when there is genuinely nothing to show; the background poll has
    // usually filled the list in already, and blanking it on every open would flicker.
    void loadChat({
      contactId: view === "thread" ? selectedContactId : "",
      silent: contacts.length > 0,
    });
  };

  const handleSelectContact = (contact) => {
    setSelectedContactId(contact.id);
    setActiveContact(contact);
    setMessages([]);
    setView("thread");
    setThreadLoading(true);
    setDraft("");
    // Opening the thread marks it read server-side; clear the badge now so it does not keep a stale
    // count until the next poll lands.
    setContacts((current) =>
      current.map((item) =>
        String(item.id) === String(contact.id) ? { ...item, unreadCount: 0 } : item
      )
    );

    void loadChat({ contactId: contact.id, silent: true });
  };

  const handleBackToList = () => {
    setView("list");
    setSelectedContactId("");
    setActiveContact(null);
    setMessages([]);
    void loadChat({ silent: true });
  };

  const handleSendMessage = async (event) => {
    event?.preventDefault();

    const messageText = draft.trim();
    const receiverId = activeContact?.id || selectedContactId;

    if (!receiverId || messageText === "" || sending) {
      return;
    }

    setSending(true);

    try {
      const result = await sendChatMessage(receiverId, messageText);

      if (!mountedRef.current) {
        return;
      }

      setDraft("");
      setContacts(Array.isArray(result.contacts) ? result.contacts : []);
      setMessages(Array.isArray(result.messages) ? result.messages : []);
      setActiveContact(result.activeContact || activeContact);
      setError("");
    } catch (requestError) {
      if (mountedRef.current) {
        setError(requestError.response?.data?.message || "Unable to send message.");
      }
    } finally {
      if (mountedRef.current) {
        setSending(false);
      }
    }
  };

  const contactName = activeContact?.name || activeContact?.username || "User";
  const contactOnline = isContactOnline(activeContact);
  const contactPresenceLabel = contactOnline ? "Online" : "Offline";

  return (
    <div ref={rootRef} className="chat-bubble relative">
      <div className="relative">
        <button
          type="button"
          aria-label="Messages"
          aria-haspopup="dialog"
          aria-expanded={open}
          title="Messages"
          onClick={handleToggle}
          className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border transition ${
            open
              ? "border-[#D61E1E]/25 bg-[#D61E1E]/10 text-[#D61E1E]"
              : "border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300 hover:bg-white"
          }`}
        >
          <MessageSquareText size={16} />
        </button>
        <NotificationBadge count={totalUnread} tone="bell" />
      </div>

      <AnimatePresence>
        {open ? (
          <motion.div
            role="dialog"
            aria-label="Messages"
            initial={{ opacity: 0, y: -10, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="chat-bubble-panel absolute right-0 top-[calc(100%+10px)] z-50 flex h-[30rem] max-h-[calc(100vh-5rem)] w-[380px] max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_24px_64px_rgba(15,23,42,0.18)]"
          >
            {view === "thread" && activeContact ? (
              <header className="flex shrink-0 items-center gap-2.5 border-b border-slate-200 px-3 py-2.5">
                <button
                  type="button"
                  aria-label="Back to conversations"
                  onClick={handleBackToList}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-[#D61E1E]"
                >
                  <ArrowLeft size={16} />
                </button>
                <div className="flex shrink-0 flex-col items-center gap-1">
                  <Avatar contact={activeContact} size="sm" showPresence />
                  <span
                    className={`flex items-center gap-1 text-[10px] font-bold leading-none ${
                      contactOnline ? "text-emerald-600" : "text-slate-400"
                    }`}
                    aria-label={`${contactName} is ${contactPresenceLabel.toLowerCase()}`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        contactOnline ? "bg-emerald-500" : "bg-slate-300"
                      }`}
                      aria-hidden="true"
                    />
                    {contactPresenceLabel}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="m-0 truncate text-sm font-bold text-slate-900">{contactName}</p>
                  <p className="m-0 mt-0.5 truncate text-[11px] font-medium text-slate-500">
                    {activeContact.role || ""}
                  </p>
                </div>
              </header>
            ) : (
              <header className="shrink-0 border-b border-slate-200 px-3.5 py-3">
                <p className="m-0 text-xs font-semibold uppercase tracking-[0.16em] text-[#D61E1E]">
                  Messages
                </p>
                <p className="m-0 mt-1 text-xs text-slate-500">
                  {totalUnread > 0
                    ? `${totalUnread} unread message${totalUnread === 1 ? "" : "s"}`
                    : "You are all caught up"}
                </p>
              </header>
            )}

            {error ? (
              <div className="flex shrink-0 items-start gap-2 border-b border-rose-100 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-700">
                <ShieldAlert size={14} className="mt-0.5 shrink-0" />
                <p className="m-0 font-medium leading-relaxed">{error}</p>
              </div>
            ) : null}

            {view === "list" ? (
              <>
                <div className="shrink-0 border-b border-slate-100 px-3 py-2.5">
                  <div className="relative">
                    <Search
                      size={14}
                      className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                    />
                    <input
                      type="search"
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder="Search conversations..."
                      aria-label="Search conversations"
                      className="h-9 w-full rounded-2xl border border-slate-200 bg-slate-50 pl-8 pr-3 text-xs text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-[#D61E1E] focus:bg-white focus:ring-2 focus:ring-[#D61E1E]/10"
                    />
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
                  {loading && contacts.length === 0 ? (
                    <div className="flex flex-col gap-2 px-2 py-3">
                      {Array.from({ length: 5 }).map((_, index) => (
                        <div key={index} className="flex animate-pulse items-center gap-3">
                          <div className="h-9 w-9 rounded-full bg-slate-200" />
                          <div className="flex-1 space-y-1.5">
                            <div className="h-3 w-2/5 rounded bg-slate-200" />
                            <div className="h-2.5 w-4/5 rounded bg-slate-200" />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : filteredContacts.length > 0 ? (
                    <div className="space-y-1">
                      {filteredContacts.map((contact) => {
                        const unreadCount = Number(contact.unreadCount) || 0;

                        return (
                          <button
                            type="button"
                            key={contact.id}
                            onClick={() => handleSelectContact(contact)}
                            className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5 rounded-2xl px-2.5 py-2.5 text-left transition hover:bg-slate-50"
                          >
                            <Avatar contact={contact} size="sm" showPresence />
                            <span className="min-w-0">
                              <span
                                className={`block truncate text-xs ${
                                  unreadCount > 0
                                    ? "font-bold text-slate-900"
                                    : "font-semibold text-slate-900"
                                }`}
                              >
                                {contact.name || contact.username || "User"}
                              </span>
                              <span
                                className={`mt-0.5 block truncate text-[11px] ${
                                  unreadCount > 0
                                    ? "font-semibold text-slate-700"
                                    : "font-medium text-slate-500"
                                }`}
                              >
                                {contact.lastMessage || contact.role || "No messages yet"}
                              </span>
                            </span>
                            <span className="flex shrink-0 flex-col items-end gap-1.5">
                              <span className="text-[10px] font-medium text-slate-400">
                                {formatContactTime(contact.lastMessageAt)}
                              </span>
                              {unreadCount > 0 ? (
                                <NotificationBadge count={unreadCount} inline />
                              ) : null}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center px-4 py-10 text-center">
                      <span className="grid h-12 w-12 place-items-center rounded-full bg-slate-100 text-slate-400">
                        <MessageSquareText size={20} />
                      </span>
                      <p className="m-0 mt-3 text-xs font-semibold text-slate-700">
                        {searchQuery.trim() ? "No conversations found" : "No contacts available yet"}
                      </p>
                      <p className="m-0 mt-1 text-[11px] text-slate-400">
                        {searchQuery.trim()
                          ? "Try a different name or keyword."
                          : "Colleagues you can message will appear here."}
                      </p>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-slate-50 px-3.5 py-3.5">
                  {threadLoading && messages.length === 0 ? (
                    <div className="flex items-center justify-center gap-2 py-10 text-xs text-slate-500">
                      <Loader2 size={15} className="animate-spin text-[#D61E1E]" />
                      Opening conversation...
                    </div>
                  ) : messages.length > 0 ? (
                    <div className="flex flex-col gap-2.5">
                      <AnimatePresence initial={false}>
                        {messages.map((message) => (
                          <motion.div
                            key={message.id}
                            initial={{ opacity: 0, y: 8, scale: 0.96 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            transition={{ duration: 0.18 }}
                            className={`flex ${message.mine ? "justify-end" : "justify-start"}`}
                          >
                            <div
                              className={`max-w-[78%] rounded-2xl px-3.5 py-2 ${
                                message.mine
                                  ? "rounded-br-sm bg-[#D61E1E] text-white"
                                  : "rounded-bl-sm border border-slate-200 bg-white text-slate-800"
                              }`}
                            >
                              <p className="m-0 whitespace-pre-wrap text-xs font-medium leading-relaxed">
                                {message.messageText}
                              </p>
                              <span
                                className={`mt-1 block text-right text-[9px] font-medium ${
                                  message.mine ? "text-red-100" : "text-slate-400"
                                }`}
                              >
                                {formatMessageTime(message.createdAt)}
                              </span>
                            </div>
                          </motion.div>
                        ))}
                      </AnimatePresence>
                      <span ref={messagesEndRef} />
                    </div>
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center px-4 text-center">
                      <span className="grid h-12 w-12 place-items-center rounded-full bg-white text-slate-400">
                        <MessageSquareText size={20} />
                      </span>
                      <p className="m-0 mt-3 text-xs font-semibold text-slate-700">
                        No messages yet
                      </p>
                      <p className="m-0 mt-1 text-[11px] text-slate-400">
                        Say hello to start the conversation.
                      </p>
                    </div>
                  )}
                </div>

                <form
                  onSubmit={handleSendMessage}
                  className="shrink-0 border-t border-slate-200 bg-white p-2.5"
                >
                  <div className="flex items-end gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-1.5 transition focus-within:border-[#D61E1E] focus-within:ring-2 focus-within:ring-[#D61E1E]/10">
                    <textarea
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      placeholder={`Message ${contactName}...`}
                      aria-label={`Message ${contactName}`}
                      rows={1}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault();
                          void handleSendMessage(event);
                        }
                      }}
                      className="max-h-24 min-h-[36px] flex-1 resize-none bg-transparent px-2 py-1.5 text-xs text-slate-800 outline-none [scrollbar-width:thin] placeholder:text-slate-400"
                    />
                    <button
                      type="submit"
                      aria-label="Send message"
                      disabled={sending || !draft.trim()}
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-[#D61E1E] text-white transition hover:bg-[#991B1B] disabled:bg-slate-200 disabled:text-slate-400"
                    >
                      {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                    </button>
                  </div>
                </form>
              </>
            )}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

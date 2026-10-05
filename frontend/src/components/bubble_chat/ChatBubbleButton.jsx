import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowLeft,
  Minus,
  Loader2,
  MessageCircleMore,
  MessageSquareText,
  Search,
  Send,
  ShieldAlert,
} from "lucide-react";
import { getChat, sendChatMessage } from "../../services/api";
import "./floatingMessenger.css";
import { Avatar, ChatTimestamp, isContactOnline } from "./chatPresentation";

function UnreadBadge({ count }) {
  return count > 0 ? <span className="messenger-unread" aria-label={count + " unread messages"}>{count > 99 ? "99+" : count}</span> : null;
}

/*
 * How often the popover re-reads messages.php. Closed, it is only keeping the unread badge honest, so it
 * polls every five seconds so a newly received message reaches the floating badge without requiring
 * the user to open it. Open, it is a conversation someone is watching, and matches the 10s the full
 * Communications workspace runs at.
 */
const CHAT_POLL_INTERVAL_OPEN_MS = 10000;
const CHAT_POLL_INTERVAL_CLOSED_MS = 5000;

/*
 * From `lg` up (1024px, where the sidebar stops collapsing) the messenger belongs in the header
 * toolbar beside the theme toggle; narrower screens keep the floating bubble. One instance serves
 * both so the badge is polled once: it is rendered next to the header and portals itself into the
 * toolbar's `headerSlot` while the query matches. It cannot simply live inside the header, because
 * the dark theme's `backdrop-filter` there would pin a fixed bubble to the 56px bar.
 */
const HEADER_PLACEMENT_QUERY = "(min-width: 1024px)";

function useHeaderPlacement() {
  const [matches, setMatches] = useState(() => (
    typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia(HEADER_PLACEMENT_QUERY).matches
  ));

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const query = window.matchMedia(HEADER_PLACEMENT_QUERY);
    const update = () => setMatches(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return matches;
}

export default function ChatBubbleButton({ user, onOpen, headerSlot = null }) {
  const inHeader = useHeaderPlacement() && Boolean(headerSlot);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const historyRef = useRef(null);
  const nearBottomRef = useRef(true);
  const selectedRef = useRef("");
  const requestRef = useRef(0);
  const draftsRef = useRef({});
  const hasOpenedRef = useRef(false);
  const reducedMotion = useReducedMotion();
  const mountedRef = useRef(false);
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
   * `contactId` is what separates the two calls this component makes. Passing one asks messages.php for
   * that thread, which also marks it read; passing nothing returns the contact list alone and
   * changes nothing. The badge poll must therefore never pass an id, or leaving the tab open would
   * quietly clear unread messages nobody had looked at.
   */
  const loadChat = useCallback(async ({ contactId = "", silent = false } = {}) => {
    const requestId = ++requestRef.current;
    if (!silent) {
      setLoading(true);
    }

    try {
      const result = await getChat(contactId);

      if (!mountedRef.current || requestId !== requestRef.current) {
        return;
      }

      setContacts(Array.isArray(result.contacts) ? result.contacts : []);

      if (contactId && String(contactId) === String(selectedRef.current)) {
        setMessages(Array.isArray(result.messages) ? result.messages : []);
        setActiveContact((current) => result.activeContact || current);
      }

      setError("");
    } catch (requestError) {
      if (mountedRef.current && requestId === requestRef.current) {
        setError(requestError.response?.data?.message || "Unable to load messages.");
      }
    } finally {
      if (mountedRef.current && requestId === requestRef.current) {
        setLoading(false);
        setThreadLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadChat();
  }, [loadChat, user?.id]);

  useEffect(() => {
    const intervalId = window.setInterval(
      () => {
        if (document.visibilityState === "hidden") {
          return;
        }

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
    const refreshVisibleChat = () => {
      if (document.visibilityState === "hidden") {
        return;
      }

      void loadChat({
        contactId: open && view === "thread" ? selectedContactId : "",
        silent: true,
      });
    };

    window.addEventListener("focus", refreshVisibleChat);
    document.addEventListener("visibilitychange", refreshVisibleChat);

    return () => {
      window.removeEventListener("focus", refreshVisibleChat);
      document.removeEventListener("visibilitychange", refreshVisibleChat);
    };
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
      if (hasOpenedRef.current) {
        triggerRef.current?.focus();
      }
      return undefined;
    }

    hasOpenedRef.current = true;

    const handleEscape = (event) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    rootRef.current?.querySelector("[role=dialog] button")?.focus();
    document.addEventListener("keydown", handleEscape);

    return () => document.removeEventListener("keydown", handleEscape);
  }, [open, view]);

  useEffect(() => {
    if (open && view === "thread" && nearBottomRef.current && historyRef.current) {
      historyRef.current.scrollTop = historyRef.current.scrollHeight;
    }
  }, [messages, open, view]);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return undefined;
    const resize = () => {
      rootRef.current?.style.setProperty("--messenger-viewport-height", viewport.height + "px");
      rootRef.current?.style.setProperty("--messenger-keyboard-offset", Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) + "px");
    };
    resize();
    viewport.addEventListener("resize", resize);
    viewport.addEventListener("scroll", resize);
    return () => {
      viewport.removeEventListener("resize", resize);
      viewport.removeEventListener("scroll", resize);
    };
  }, []);

  useEffect(() => {
    const input = rootRef.current?.querySelector("textarea");
    if (input) {
      input.style.height = "auto";
      input.style.height = Math.min(input.scrollHeight, 96) + "px";
    }
  }, [draft, open, view]);

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
    selectedRef.current = contact.id;
    nearBottomRef.current = true;
    setSelectedContactId(contact.id);
    setActiveContact(contact);
    setMessages([]);
    setView("thread");
    setThreadLoading(true);
    setDraft(draftsRef.current[contact.id] || "");
    void loadChat({ contactId: contact.id, silent: true });
  };

  const handleBackToList = () => {
    selectedRef.current = "";
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

    if (!receiverId || messageText === "" || sending || threadLoading) {
      return;
    }

    setSending(true);
    ++requestRef.current;

    try {
      const result = await sendChatMessage(receiverId, messageText);

      if (!mountedRef.current) {
        return;
      }

      if (String(selectedRef.current) === String(receiverId)) {
        ++requestRef.current;
        setLoading(false);
        setThreadLoading(false);
      }
      if (draftsRef.current[receiverId]?.trim() === messageText) {
        draftsRef.current[receiverId] = "";
        if (String(selectedRef.current) === String(receiverId)) setDraft("");
      }
      setContacts(Array.isArray(result.contacts) ? result.contacts : []);
      if (String(selectedRef.current) === String(receiverId)) {
        setMessages(Array.isArray(result.messages) ? result.messages : []);
        setActiveContact(result.activeContact || activeContact);
      }
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

  const closePanel = () => {
    setOpen(false);
  };
  const minimizeButton = <button type="button" onClick={closePanel} aria-label="Minimize messages" className="messenger-minimize"><Minus size={20} /></button>;

  const messenger = (
    <div
      ref={rootRef}
      className="chat-bubble floating-messenger"
      data-open={open ? "true" : "false"}
      data-placement={inHeader ? "header" : "floating"}
    >
      {/* Stays mounted while open: in the header it shows the active state, like the bell beside it. */}
      <div className="relative">
        <button
          type="button"
          ref={triggerRef}
          aria-controls="floating-messenger-panel"
          aria-label={totalUnread > 0 ? "Messages, " + totalUnread + " unread" : "Messages"}
          aria-haspopup="dialog"
          aria-expanded={open ? "true" : "false"}
          title="Messages"
          onClick={handleToggle}
          className="messenger-trigger"
        >
          <MessageCircleMore size={24} />
        </button>
        <UnreadBadge count={totalUnread} />
      </div>

      <AnimatePresence>
        {open ? (
          <motion.div
            id="floating-messenger-panel"
            role="dialog"
            aria-label="Messages"
            initial={{ opacity: 0, y: 10, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: reducedMotion ? 0 : 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="chat-bubble-panel messenger-panel flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white"
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
                <Avatar contact={activeContact} size="sm" showPresence />
                <div className="min-w-0 flex-1">
                  <p className="m-0 truncate text-sm font-bold text-slate-900">{contactName}</p>
                  <p className="m-0 mt-0.5 truncate text-[11px] font-medium text-slate-500">
                    {contactOnline ? "Active now" : contactPresenceLabel}
                  </p>
                </div>
                {minimizeButton}
              </header>
            ) : (
              <header className="flex shrink-0 items-center justify-between border-b border-slate-200 px-3.5 py-3">
                <div>
                <p className="m-0 text-base font-semibold text-slate-900">
                  Messages
                </p>
                {totalUnread > 0 ? (
                  <p className="m-0 mt-1 text-xs text-slate-500">
                    {`${totalUnread} unread message${totalUnread === 1 ? "" : "s"}`}
                  </p>
                ) : null}
                </div>
                {minimizeButton}
              </header>
            )}

            {error ? (
              <div role="alert" className="flex shrink-0 items-start gap-2 border-b border-rose-100 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-700">
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
                      placeholder="Search people or conversations..."
                      aria-label="Search people or conversations"
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
                                <ChatTimestamp value={contact.lastMessageAt} />
                              </span>
                              {unreadCount > 0 ? (
                                <UnreadBadge count={unreadCount} />
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
                        {searchQuery.trim() ? "No conversations found" : "No conversations yet"}
                      </p>
                      <p className="m-0 mt-1 text-[11px] text-slate-400">
                        {searchQuery.trim()
                          ? "Try a different name or keyword."
                          : "Search for someone to start chatting."}
                      </p>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                <div ref={historyRef} role="log" aria-label="Message history" aria-live="polite" aria-busy={threadLoading}
                  onScroll={(event) => {
                    const node = event.currentTarget;
                    nearBottomRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 64;
                  }}
                  className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain bg-slate-50 px-3.5 py-3.5">
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
                            transition={{ duration: reducedMotion ? 0 : 0.18 }}
                            className={`flex ${message.mine ? "justify-end" : "justify-start"}`}
                          >
                            <div
                              className={`messenger-message-bubble max-w-[78%] rounded-2xl px-3.5 py-2 ${
                                message.mine
                                  ? "messenger-message-bubble--mine rounded-br-sm bg-[#D61E1E] text-white"
                                  : "messenger-message-bubble--incoming rounded-bl-sm border border-slate-200 bg-white text-slate-800"
                              }`}
                            >
                              <p className="m-0 whitespace-pre-wrap break-words text-sm font-medium leading-relaxed">
                                {message.messageText}
                              </p>
                              <span
                                className={`mt-1 block text-right text-[9px] font-medium ${
                                  message.mine ? "text-red-100" : "text-slate-400"
                                }`}
                              >
                                <ChatTimestamp value={message.createdAt} />
                              </span>
                            </div>
                          </motion.div>
                        ))}
                      </AnimatePresence>
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
                        Start the conversation.
                      </p>
                    </div>
                  )}
                </div>

                <form
                  onSubmit={handleSendMessage}
                  className="shrink-0 border-t border-slate-200 bg-white p-2.5"
                >
                  <div className="messenger-composer flex items-end gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-1.5 transition">
                    <textarea
                      value={draft}
                      onChange={(event) => { setDraft(event.target.value); draftsRef.current[selectedContactId] = event.target.value; }}
                      placeholder={`Message ${contactName}...`}
                      aria-label={`Message ${contactName}`}
                      rows={1}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                          event.preventDefault();
                          void handleSendMessage(event);
                        }
                      }}
                      className="messenger-composer-input max-h-24 min-h-[36px] flex-1 resize-none border-0 bg-transparent px-2 py-1.5 text-xs text-slate-800 outline-none [scrollbar-width:thin] placeholder:text-slate-400"
                    />
                    <button
                      type="submit"
                      aria-label="Send message"
                      disabled={sending || threadLoading || !draft.trim()}
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

  return inHeader ? createPortal(messenger, headerSlot) : messenger;
}

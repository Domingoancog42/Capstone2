import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BookOpen, CalendarDays, CircleHelp, Grid2X2, History, Info, LoaderCircle, MessageCircle, Plus, Search, Send, Settings, Sparkles, TrendingUp } from "lucide-react";
import Modal from "../UI/modal";
import { askFaq, getFaqs } from "../../services/faqService";
import { FAQ_CATEGORY_GROUPS, faqCategoryGroup } from "./faqPresentation";
import { FaqGuideCard, FaqHero, FaqMessage, FaqWaves, FaqWelcome } from "./FaqAssistantView";
import FaqChatHistory from "./FaqChatHistory";
import { loadFaqHistory, saveFaqHistory, updateFaqHistory } from "./faqHistory";
import "./FaqAssistant.css";

const STARTERS = [
  { text: "What functions does this system have?", icon: Settings },
  { text: "How does payroll approval work?", icon: CalendarDays },
  { text: "How do promotions work?", icon: TrendingUp },
];
const WELCOME = { role: "assistant", content: "Hi! Ask me how any part of your HR system works: requests and approvals, employee management, profiles and PDS, attendance, payroll and loans, performance, promotions, rewards, reports, or administration settings. I can explain the steps and help with errors.", source: "welcome" };
const HEADER_TRIGGER_QUERY = "(min-width: 1024px)";

export default function FaqAssistant({ userId, onOpen }) {
  return <FaqAssistantSession key={userId == null ? "anonymous" : String(userId)} userId={userId} onOpen={onOpen} />;
}

function FaqAssistantSession({ userId, onOpen }) {
  const [open, setOpen] = useState(false);
  const [floatingTrigger, setFloatingTrigger] = useState(() => typeof window.matchMedia === "function" && !window.matchMedia(HEADER_TRIGGER_QUERY).matches);
  const [tab, setTab] = useState("chat");
  const [faqs, setFaqs] = useState([]);
  const [faqLoading, setFaqLoading] = useState(false);
  const [faqError, setFaqError] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [chatHistory, setChatHistory] = useState(() => loadFaqHistory(userId));
  const [messages, setMessages] = useState(() => [WELCOME, ...(chatHistory.conversations.find((chat) => chat.id === chatHistory.activeId)?.messages || [])]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyNotice, setHistoryNotice] = useState("");
  const [question, setQuestion] = useState("");
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState("");
  const triggerRef = useRef(null);
  const contentRef = useRef(null);
  const inputRef = useRef(null);
  const transcriptRef = useRef(null);
  const requestRef = useRef(null);
  const sendingRef = useRef(false);
  const historyTriggerRef = useRef(null);

  useEffect(() => {
    setHistoryNotice(saveFaqHistory(userId, chatHistory) ? "" : "Chat history could not be saved in this browser. You can keep chatting, but recent changes may be lost after reloading.");
  }, [chatHistory, userId]);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const query = window.matchMedia(HEADER_TRIGGER_QUERY);
    const update = () => setFloatingTrigger(!query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => () => requestRef.current?.abort(), []);
  useEffect(() => {
    if (!open) return undefined;
    const controller = new AbortController();
    setFaqLoading(true); setFaqError("");
    getFaqs({ signal: controller.signal }).then((entries) => {
      if (!controller.signal.aborted) setFaqs(entries);
    }).catch(() => {
      if (!controller.signal.aborted) setFaqError("Unable to load the FAQ list. Close and reopen help to retry.");
    }).finally(() => { if (!controller.signal.aborted) setFaqLoading(false); });
    return () => controller.abort();
  }, [open]);
  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [open]);
  useEffect(() => {
    if (!open) return undefined;
    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 0);
    const trapFocus = (event) => {
      if (event.key !== "Tab") return;
      const panel = contentRef.current?.closest(".app-modal-panel");
      const focusable = [...(panel?.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex="0"]') || [])].filter((node) => node.tabIndex >= 0 && node.getClientRects().length > 0);
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", trapFocus);
    return () => { window.clearTimeout(focusTimer); document.removeEventListener("keydown", trapFocus); };
  }, [open, tab, historyOpen]);
  useEffect(() => { const transcript = transcriptRef.current; if (transcript) transcript.scrollTop = transcript.scrollHeight; }, [messages, sending, open, tab, historyOpen]);
  useEffect(() => { if (open && tab === "chat" && !sending && !historyOpen) inputRef.current?.focus(); }, [open, tab, sending, historyOpen]);

  const close = () => { setOpen(false); triggerRef.current?.focus(); };
  const newChat = () => {
    if (sendingRef.current) return;
    setChatHistory((history) => ({ ...history, activeId: null }));
    setMessages([WELCOME]); setQuestion(""); setChatError(""); setHistoryOpen(false); setTab("chat"); inputRef.current?.focus();
  };
  const openChat = (chat) => {
    if (sendingRef.current) return;
    setChatHistory((history) => ({ ...history, activeId: chat.id }));
    setMessages([WELCOME, ...chat.messages]); setQuestion(""); setChatError(""); setHistoryOpen(false); setTab("chat");
  };
  const deleteChat = (id) => {
    if (sendingRef.current) return;
    setChatHistory((history) => ({ activeId: history.activeId === id ? null : history.activeId, conversations: history.conversations.filter((chat) => chat.id !== id) }));
    if (chatHistory.activeId === id) { setMessages([WELCOME]); setQuestion(""); setChatError(""); }
    historyTriggerRef.current?.focus();
  };
  const send = async (text = question) => {
    const value = text.trim();
    if (!value || sendingRef.current) return;
    const history = messages.filter((message) => message.source !== "welcome").slice(-10).map(({ role, content }) => ({ role, content }));
    const previous = messages;
    sendingRef.current = true; setSending(true); setChatError(""); setQuestion(""); setTab("chat"); setHistoryOpen(false);
    setMessages([...previous, { role: "user", content: value }]);
    const controller = new AbortController(); requestRef.current = controller;
    try {
      const reply = await askFaq(value, history, { signal: controller.signal });
      if (!controller.signal.aborted) {
        const completed = [...previous, { role: "user", content: value }, { role: "assistant", content: reply.answer, source: reply.source, notice: reply.notice, references: reply.references || [] }];
        setMessages(completed);
        setChatHistory((history) => updateFaqHistory(history, completed.slice(1)));
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setMessages(previous); setQuestion(value);
        setChatError(error?.response?.data?.message || error?.message || "Unable to send your question. Please try again.");
      }
    } finally {
      if (!controller.signal.aborted) { sendingRef.current = false; setSending(false); requestRef.current = null; }
    }
  };
  const moduleCount = faqs.filter((faq) => faq.module).length;
  const groups = FAQ_CATEGORY_GROUPS.map((group) => ({ ...group, count: group.id ? faqs.filter((faq) => faqCategoryGroup(faq) === group.id).length : faqs.length }));
  const filteredFaqs = faqs.filter((faq) => (!category || faqCategoryGroup(faq) === category) && `${faq.category} ${faq.question} ${faq.answer} ${(faq.keywords || []).join(" ")} ${Object.values(faq.facts || {}).flat().join(" ")}`.toLowerCase().includes(search.trim().toLowerCase()));
  const openReference = (reference) => { setCategory(""); setSearch(faqs.find((faq) => faq.id === reference.id)?.question || reference.title); setTab("faqs"); };

  const trigger = <button ref={triggerRef} type="button" aria-label="Open FAQ assistant" aria-haspopup="dialog" aria-expanded={open} title="Help & FAQ" data-placement={floatingTrigger ? "floating" : "header"}
      className="app-faq-trigger grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-slate-200 bg-slate-50 text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D61E1E]/35 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
      onClick={() => { onOpen?.(); setOpen(true); }}><CircleHelp size={18} aria-hidden="true" /></button>;

  return <>
    {/* Escape the header's backdrop-filter so the mobile trigger stays fixed to the viewport. */}
    {floatingTrigger ? createPortal(trigger, document.body) : trigger}
    <Modal open={open} onClose={close} title="Help & FAQ" portal showCloseButton={false} closeLabel="Close FAQ assistant" maxWidth="max-w-none" containerClassName="faq-modal-container" panelClassName="faq-design-dialog" headerClassName="faq-modal-header" contentClassName="faq-modal-content">
      <div ref={contentRef} className="faq-design">
        <FaqHero tab={tab} moduleCount={moduleCount} onClose={close} />
        <div className="faq-toolbar"><div className="faq-tabs" role="tablist" aria-label="Help options">
          {[["chat", "Ask Assistant", Sparkles], ["faqs", "Browse FAQs", BookOpen]].map(([id, label, Icon]) => <button key={id} type="button" role="tab" className="faq-tab" id={`faq-tab-${id}`} aria-label={id === "chat" ? "Ask assistant" : label} aria-selected={tab === id} aria-controls={`faq-panel-${id}`} tabIndex={tab === id ? 0 : -1} onClick={() => setTab(id)} onKeyDown={(event) => {
            if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) { event.preventDefault(); const next = event.key === "Home" ? "chat" : event.key === "End" ? "faqs" : tab === "chat" ? "faqs" : "chat"; setTab(next); document.getElementById(`faq-tab-${next}`)?.focus(); }
          }}><Icon size={22} aria-hidden="true" />{label}</button>)}
        </div>{tab === "chat" ? <div className="faq-chat-actions"><button ref={historyTriggerRef} type="button" className="faq-reset faq-history-toggle" disabled={sending} aria-label="Chat history" title="Chat history" aria-expanded={historyOpen} aria-controls="faq-history-panel" onClick={() => setHistoryOpen((value) => !value)}><History size={17} aria-hidden="true" /><span>History</span></button><button type="button" className="faq-reset" disabled={sending} aria-label="Start a new FAQ conversation" title="New chat" onClick={newChat}><Plus size={19} aria-hidden="true" /></button></div> : null}</div>

        {tab === "chat" ? <div id="faq-panel-chat" role="tabpanel" aria-labelledby="faq-tab-chat" className="faq-chat-panel">
          {historyOpen ? <FaqChatHistory conversations={chatHistory.conversations} activeId={chatHistory.activeId} notice={historyNotice} onOpen={openChat} onDelete={deleteChat} onNewChat={newChat} /> : <>
          <div className="faq-chat-surface"><FaqWaves /><div ref={transcriptRef} role="log" aria-label="FAQ conversation" aria-live="polite" aria-relevant="additions text" className="faq-conversation">
            <FaqWelcome message={WELCOME.content} />
            {messages.slice(1).map((message, index) => <FaqMessage key={index} message={message} onOpenReference={openReference} />)}
            {sending ? <div role="status" className="faq-thinking"><span className="sr-only">Finding an answer...</span><span className="faq-thinking__dots" aria-hidden="true"><span /><span /><span /></span></div> : null}
            {messages.length === 1 && !sending ? <div className="faq-starters">{STARTERS.map(({ text, icon: Icon }) => <button key={text} type="button" className="faq-starter" onClick={() => send(text)}><Icon size={23} strokeWidth={2.2} aria-hidden="true" /><span>{text}</span></button>)}</div> : null}
          </div></div>
          {historyNotice ? <p className="faq-history__notice" role="status">{historyNotice}</p> : null}
          <form className="faq-composer" onSubmit={(event) => { event.preventDefault(); send(); }}>
            {chatError ? <p role="alert" className="faq-error">{chatError}</p> : null}<label htmlFor="faq-question" className="sr-only">Your question</label>
            <div className="faq-composer__row"><div className="faq-composer__field"><span className="faq-composer__icon" aria-hidden="true"><MessageCircle size={23} /></span><textarea ref={inputRef} id="faq-question" rows={1} maxLength={2000} value={question} disabled={sending} placeholder="Ask how to use the system..." onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(); } }} /></div>
              <button type="submit" className="faq-send" disabled={!question.trim() || sending} aria-label="Send FAQ question">{sending ? <LoaderCircle size={23} aria-hidden="true" /> : <Send size={23} aria-hidden="true" />}<span>Send</span></button></div>
          </form>
          <p className="faq-disclaimer"><Info size={17} aria-hidden="true" /><span>AI answers use the system guide. Share general questions only; keep passwords and personal records private. Confirm HR policies with HR.</span></p>
          </>}
        </div> : <div id="faq-panel-faqs" role="tabpanel" aria-labelledby="faq-tab-faqs" className="faq-browse-panel">
          <div className="faq-browser"><aside className="faq-categories"><h3><Grid2X2 size={22} fill="currentColor" aria-hidden="true" />Categories</h3><nav aria-label="FAQ categories">{groups.map(({ id, label, icon: Icon, count }) => <button key={id} type="button" className="faq-category" aria-label={`Filter ${label}`} aria-pressed={category === id} onClick={() => setCategory(id)}><Icon size={21} strokeWidth={2.3} aria-hidden="true" /><span>{label}</span><span className="faq-category__count">{count}</span></button>)}</nav></aside>
            <section className="faq-guides" aria-label="System guides"><label className="faq-search"><span className="sr-only">Search FAQs</span><Search size={22} aria-hidden="true" /><input ref={inputRef} type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search FAQs..." /></label>
              <div className="faq-category-mobile"><select aria-label="Guide category" value={category} onChange={(event) => setCategory(event.target.value)}>{groups.map(({ id, label, count }) => <option key={id} value={id}>{label} ({count})</option>)}</select><span>{filteredFaqs.length} guides</span></div>
              <div className="faq-guide-list">{faqLoading ? <p role="status" className="faq-guide-state">Loading FAQs...</p> : faqError ? <p role="alert" className="faq-error">{faqError}</p> : filteredFaqs.length === 0 ? <p className="faq-guide-state">No matching FAQs. Try another search or ask the assistant.</p> : filteredFaqs.map((faq) => <FaqGuideCard key={faq.id} faq={faq} sending={sending} onAsk={send} />)}</div>
            </section></div>
          <div className="faq-support"><Info size={28} aria-hidden="true" /><p>Still need help? You can also ask our system assistant for personalized support.</p><button type="button" className="faq-support__button" onClick={() => setTab("chat")}><Sparkles size={21} aria-hidden="true" />Ask Assistant</button></div>
        </div>}
      </div>
    </Modal>
  </>;
}

import React from "react";
import { BookOpen, Bot, ChevronDown, MessageCircle, UserRound, X } from "lucide-react";
import mascot from "../../assets/faq-assistant-mascot.png";
import { faqRowIcon } from "./faqPresentation";

export function FaqHero({ tab, moduleCount, onClose }) {
  return <section className="faq-hero" aria-label="Help and FAQ introduction">
    {tab === "chat" ? <div className="faq-hero__mascot" aria-hidden="true"><img src={mascot} alt="" /></div>
      : <div className="faq-hero__book" aria-hidden="true"><BookOpen size={49} strokeWidth={2} /></div>}
    <div className="faq-hero__copy"><h2>Help &amp; FAQ</h2><p>{moduleCount ? `System guides for ${moduleCount} ${moduleCount === 1 ? "area" : "areas"}, with help for your role.` : "Your guide to the MGB HR information system."}</p></div>
    <button type="button" className="faq-close" aria-label="Close FAQ assistant" onClick={onClose}><X size={17} aria-hidden="true" /></button>
  </section>;
}

export function FaqWaves() {
  return <svg className="faq-waves" viewBox="0 0 1100 240" preserveAspectRatio="none" aria-hidden="true" focusable="false">
    <path d="M0 70 C205 125 235 246 475 181 C726 113 767 -15 1100 71 L1100 240 L0 240Z" fill="#dce9ff" opacity=".72" />
    <path d="M0 205 C207 137 333 285 562 229 C813 170 936 10 1100 0 L1100 240 L0 240Z" fill="#c7ddff" opacity=".55" />
    <path d="M0 195 C177 177 278 300 526 234 C800 161 912 52 1100 92 L1100 240 L0 240Z" fill="#aecdff" opacity=".43" />
  </svg>;
}

export function FaqWelcome({ message }) {
  return <div className="faq-welcome"><div className="faq-welcome__mascot" aria-hidden="true"><img src={mascot} alt="" /></div>
    <div className="faq-welcome__body"><span className="faq-welcome__name">MGB HRIS Assistant</span><p className="faq-welcome__text">{message}</p></div>
    <span className="faq-welcome__accents" aria-hidden="true"><i /><i /><i /></span>
  </div>;
}

export function FaqMessage({ message, onOpenReference }) {
  const userMessage = message.role === "user";
  return <div className={`faq-message ${userMessage ? "faq-message--user" : ""}`}>
    {!userMessage ? <span className="faq-message__avatar" aria-hidden="true"><Bot size={18} /></span> : null}
    <div className="faq-message__bubble"><p className="faq-message__name">{userMessage ? "You" : message.source === "guide" ? "System FAQ" : "MGB HRIS Assistant"}</p><p className="faq-message__body">{message.content}</p>
      {message.notice ? <p className="faq-message__notice">{message.notice}</p> : null}
      {message.references?.length ? <div className="faq-references"><p>Related system guides</p><div>{message.references.map((reference) => <button key={reference.id} type="button" onClick={() => onOpenReference(reference)}>{reference.title}</button>)}</div></div> : null}
    </div>
    {userMessage ? <span className="faq-message__avatar" aria-hidden="true"><UserRound size={17} /></span> : null}
  </div>;
}

export function FaqGuideCard({ faq, sending, onAsk }) {
  const Icon = faqRowIcon(faq);
  const hasFacts = faq.facts && Object.values(faq.facts).some((items) => items.length);
  return <details className="faq-guide"><summary><span className="faq-guide__icon"><Icon size={21} strokeWidth={2.2} aria-hidden="true" /></span><span className="faq-guide__title">{faq.question}</span><ChevronDown className="faq-guide__chevron" size={21} strokeWidth={2.8} aria-hidden="true" /></summary>
    <div className="faq-guide__content"><p className="faq-guide__category">{faq.category}</p><p className="faq-guide__answer">{faq.answer}</p>
      {hasFacts ? <details className="faq-guide__facts"><summary>Screen fields, actions and validation messages</summary><p>Available controls depend on your permissions and the record&apos;s current stage.</p>
        {[["headings", "Sections"], ["actions", "Actions"], ["fields", "Fields"], ["labels", "Labels and options"], ["descriptions", "Guidance"], ["validation", "Validation messages"]].map(([key, label]) => faq.facts[key]?.length ? <div key={key}><strong>{label}</strong><p>{faq.facts[key].join(" · ")}</p></div> : null)}
      </details> : null}
      <button type="button" className="faq-guide__ask" disabled={sending} onClick={() => onAsk(faq.question)}><MessageCircle size={14} aria-hidden="true" />Ask about this</button>
    </div>
  </details>;
}

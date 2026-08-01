import React from "react";
import { motion } from "framer-motion";

export default function ProfileTabNav({ tabs = [], activeTab, onChange, className = "" }) {
  return (
    <div className={`profile-tab-nav sticky top-20 z-20 overflow-x-auto rounded-[24px] border border-[#F8BFBF]/80 bg-white/95 px-2 py-2 shadow-sm backdrop-blur ${className}`.trim()}>
      <div className="flex min-w-max gap-1.5">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTab;

          return (
            <button
              key={tab.id}
              type="button"
              data-active={isActive}
              onClick={() => onChange(tab.id)}
              className={`profile-tab-nav-item relative rounded-2xl px-4 py-3 text-sm font-semibold transition ${
                isActive ? "text-[#D61E1E]" : "text-slate-500 hover:text-[#B41818]"
              }`}
            >
              {isActive ? (
                <motion.span
                  layoutId="profile-tab-indicator"
                  className="profile-tab-indicator absolute inset-0 rounded-2xl bg-gradient-to-r from-[#fbecec] via-white to-[#fde8e8]"
                  transition={{ type: "spring", stiffness: 380, damping: 34 }}
                />
              ) : null}
              <span className="relative z-10">{tab.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

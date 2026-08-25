import React from "react";
import { motion } from "framer-motion";
import Card from "../UI/card";

export default function AdminStatCard({ stat, index = 0 }) {
  const Icon = stat.icon;
  const isClickable = typeof stat.onClick === "function";
  const Wrapper = isClickable ? motion.button : motion.div;

  return (
    <Wrapper
      type={isClickable ? "button" : undefined}
      onClick={stat.onClick}
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={isClickable ? { y: -4 } : undefined}
      whileTap={isClickable ? { scale: 0.99 } : undefined}
      transition={{ duration: 0.35, delay: index * 0.04 }}
      className={`w-full text-left ${isClickable ? "cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-200" : ""}`.trim()}
    >
      <Card className="group relative overflow-hidden border-slate-200/80 bg-white/95 shadow-sm transition duration-300 hover:-translate-y-1 hover:shadow-[0_24px_46px_rgba(15,23,42,0.10)]">
        <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${stat.accent}`} />
        <div className={`absolute -right-10 top-0 h-28 w-28 rounded-full opacity-30 blur-3xl transition duration-300 group-hover:opacity-45 ${stat.glow}`} />

        <div className="relative space-y-4 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="m-0 text-sm font-semibold text-slate-500">{stat.label}</p>
              <strong className="mt-3 block text-[2rem] font-semibold leading-none text-slate-900">
                {stat.value}
              </strong>
            </div>

            <div className={`grid h-12 w-12 place-items-center rounded-2xl text-white shadow-lg ${stat.iconTone}`}>
              <Icon size={22} />
            </div>
          </div>
        </div>
      </Card>
    </Wrapper>
  );
}

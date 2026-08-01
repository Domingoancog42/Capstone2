import React from "react";

export default function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="mt-8 border-t border-slate-200 bg-transparent py-6">
      <div className="container mx-auto px-6">
        <p className="m-0 text-center text-sm text-slate-600">
          © {currentYear} Mines and Geosciences Bureau – Human Resources Information System. All Rights Reserved.
        </p>
      </div>
    </footer>
  );
}

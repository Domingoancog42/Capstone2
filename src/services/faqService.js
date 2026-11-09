import api from "./api";

export async function getFaqs({ signal } = {}) {
  const { data } = await api.get("/faq_assistant.php", { signal });
  return Array.isArray(data.faqs) ? data.faqs : [];
}

export async function askFaq(question, history = [], { signal } = {}) {
  const { data } = await api.post("/faq_assistant.php", { question, history, page: window.location.pathname }, { signal, timeout: 90000, skipAutoRefresh: true });
  if (!data.success || !data.answer) {
    throw new Error(data.message || "The assistant could not answer. Please try again.");
  }
  return data;
}

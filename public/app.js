const apiKey = new URLSearchParams(location.search).get("key");

function authHeaders() {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

function inr(amount) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(
    amount,
  );
}

const conversation = document.getElementById("conversation");
const askForm = document.getElementById("askForm");
const textInput = document.getElementById("textInput");
const micButton = document.getElementById("micButton");
const langSelect = document.getElementById("lang");
const shopNameInput = document.getElementById("shopName");
const upiIdInput = document.getElementById("upiId");
const ledgerSummary = document.getElementById("ledgerSummary");
const ledgerDues = document.getElementById("ledgerDues");

function addBubble(role, text, isError) {
  const bubble = document.createElement("div");
  bubble.className = `bubble ${role}${isError ? " error" : ""}`;
  bubble.textContent = text;
  conversation.appendChild(bubble);
  conversation.scrollTop = conversation.scrollHeight;
}

function addCard(renderRow) {
  const card = document.createElement("div");
  card.className = "card";
  renderRow(card);
  conversation.appendChild(card);
  conversation.scrollTop = conversation.scrollHeight;
}

function renderStructuredContent(structured) {
  if (!structured) return;

  if (Array.isArray(structured.dues) && structured.dues.length > 0) {
    addCard((card) => {
      for (const d of structured.dues) {
        const row = document.createElement("div");
        row.className = "row";
        row.innerHTML = `<span class="name">${d.displayName}</span><span class="amount">${inr(d.balance)}</span>`;
        card.appendChild(row);
      }
    });
  }

  if (Array.isArray(structured.items) && structured.items.length > 0) {
    addCard((card) => {
      for (const item of structured.items) {
        const row = document.createElement("div");
        row.className = "row";
        row.innerHTML = `<span class="name">#${item.priority} ${item.customer}</span><span class="amount">${inr(item.balance)}</span>`;
        card.appendChild(row);
        const days = document.createElement("div");
        days.className = "message";
        days.textContent = `${item.daysSinceActivity} days since last activity — ${item.message}`;
        card.appendChild(days);
      }
    });
  }

  if (typeof structured.balance === "number" && structured.customer && !Array.isArray(structured.dues)) {
    addCard((card) => {
      const row = document.createElement("div");
      row.className = "row";
      row.innerHTML = `<span class="name">${structured.customer}</span><span class="amount">${inr(structured.balance)}</span>`;
      card.appendChild(row);
    });
  }
}

function speak(text) {
  if (!("speechSynthesis" in window)) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = langSelect.value;
  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
}

async function refreshState() {
  try {
    const res = await fetch("/api/state", { headers: authHeaders() });
    if (!res.ok) return;
    const state = await res.json();
    ledgerSummary.innerHTML = `
      <div class="stat"><div class="label">Credit today</div><div class="value">${inr(state.summary.credit)}</div></div>
      <div class="stat"><div class="label">Payments today</div><div class="value">${inr(state.summary.payments)}</div></div>
      <div class="stat"><div class="label">Entries today</div><div class="value">${state.summary.count}</div></div>
      <div class="stat"><div class="label">Outstanding</div><div class="value">${inr(state.summary.totalOutstanding)}</div></div>
    `;
    ledgerDues.innerHTML = "";
    for (const due of state.dues) {
      const li = document.createElement("li");
      li.innerHTML = `<span>${due.displayName}</span><span class="amount">${inr(due.balance)}</span><span class="days">${due.daysSinceActivity}d</span>`;
      ledgerDues.appendChild(li);
    }
  } catch {
    // ledger panel is best-effort; ignore transient failures
  }
}

async function ask(utterance) {
  addBubble("user", utterance);
  try {
    const res = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({
        utterance,
        shopName: shopNameInput.value.trim() || undefined,
        upiId: upiIdInput.value.trim() || undefined,
        language: langSelect.value.startsWith("ta") ? "Tamil" : langSelect.value.startsWith("hi") ? "Hindi" : "English",
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      addBubble("assistant", data.error ?? "Something went wrong.", true);
      return;
    }
    addBubble("assistant", data.reply, data.isError);
    speak(data.reply);
    renderStructuredContent(data.structuredContent);
  } catch (err) {
    addBubble("assistant", "Could not reach the server.", true);
    console.error(err);
  }
  refreshState();
}

askForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = textInput.value.trim();
  if (!text) return;
  textInput.value = "";
  ask(text);
});

const SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognizer;
if (SpeechRecognitionImpl) {
  recognizer = new SpeechRecognitionImpl();
  recognizer.interimResults = false;
  recognizer.maxAlternatives = 1;

  recognizer.onresult = (event) => {
    const text = event.results[0][0].transcript;
    textInput.value = text;
    ask(text);
  };
  recognizer.onend = () => micButton.classList.remove("recording");
  recognizer.onerror = () => micButton.classList.remove("recording");

  micButton.addEventListener("click", () => {
    recognizer.lang = langSelect.value;
    micButton.classList.add("recording");
    recognizer.start();
  });
} else {
  micButton.disabled = true;
  micButton.title = "Speech recognition not supported in this browser — use the text box.";
}

refreshState();

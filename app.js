const $ = id => document.getElementById(id);
let mode = "login";
let currentUser = null;
let activeFriend = null;
let poller = null;
let lastMessageId = 0;

function setMode(next) {
  mode = next;
  $("loginTab").classList.toggle("active", mode === "login");
  $("registerTab").classList.toggle("active", mode === "register");
  $("nameField").classList.toggle("hidden", mode !== "register");
  $("authSubmit").textContent = mode === "login" ? "Sign in" : "Create account";
  $("password").autocomplete = mode === "login" ? "current-password" : "new-password";
  $("authError").textContent = "";
}
$("loginTab").onclick = () => setMode("login");
$("registerTab").onclick = () => setMode("register");

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

$("authForm").onsubmit = async e => {
  e.preventDefault();
  $("authSubmit").disabled = true;
  $("authError").textContent = "";
  try {
    const payload = { email: $("email").value, password: $("password").value };
    if (mode === "register") payload.name = $("name").value;
    const data = await api(`/api/${mode === "login" ? "login" : "register"}`, {
      method: "POST", body: JSON.stringify(payload)
    });
    currentUser = data.user;
    showApp();
  } catch (err) {
    $("authError").textContent = err.message;
  } finally {
    $("authSubmit").disabled = false;
  }
};

function showApp() {
  $("authView").classList.add("hidden");
  $("appView").classList.remove("hidden");
  $("myName").textContent = currentUser.name;
  $("myEmail").textContent = currentUser.email;
  $("myAvatar").textContent = currentUser.name[0].toUpperCase();
}

$("logout").onclick = async () => {
  try { await api("/api/logout", { method: "POST", body: "{}" }); } catch (_) {}
  location.reload();
};

let searchTimer;
$("search").addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(searchUsers, 250);
});

async function searchUsers() {
  const q = $("search").value.trim();
  $("searchResults").innerHTML = "";
  if (q.length < 2) return;
  try {
    const data = await api(`/api/users?q=${encodeURIComponent(q)}`);
    if (!data.users.length) {
      $("searchResults").textContent = "No members found.";
      return;
    }
    data.users.forEach(user => {
      const button = document.createElement("button");
      button.className = "person";
      const avatar = document.createElement("span");
      avatar.className = "avatar";
      avatar.textContent = user.name[0].toUpperCase();
      const info = document.createElement("span");
      const name = document.createElement("b");
      name.textContent = user.name;
      const email = document.createElement("small");
      email.textContent = user.email;
      info.append(name, email);
      button.append(avatar, info);
      button.onclick = () => openChat(user);
      $("searchResults").append(button);
    });
  } catch (err) { $("searchResults").textContent = err.message; }
}

async function openChat(user) {
  activeFriend = user;
  lastMessageId = 0;
  $("emptyChat").classList.add("hidden");
  $("activeChat").classList.remove("hidden");
  $("friendName").textContent = user.name;
  $("friendEmail").textContent = user.email;
  $("friendAvatar").textContent = user.name[0].toUpperCase();
  if (poller) clearInterval(poller);
  await loadMessages();
  poller = setInterval(loadMessages, 3000);
  $("messageInput").focus();
}

async function loadMessages() {
  if (!activeFriend) return;
  try {
    const data = await api(`/api/messages/${activeFriend.id}`);
    const box = $("messages");
    const newest = data.messages.length ? Number(data.messages[data.messages.length - 1].id) : 0;
    if (newest === lastMessageId && box.children.length === data.messages.length) return;
    box.replaceChildren();
    data.messages.forEach(message => {
      const bubble = document.createElement("div");
      bubble.className = "bubble " + (Number(message.sender_id) === Number(currentUser.id) ? "mine" : "theirs");
      const body = document.createElement("div");
      body.textContent = message.body;
      const time = document.createElement("div");
      time.className = "time";
      time.textContent = new Date(message.created_at).toLocaleString([], { hour: "2-digit", minute: "2-digit", month: "short", day: "numeric" });
      bubble.append(body, time);
      box.append(bubble);
    });
    lastMessageId = newest;
    box.scrollTop = box.scrollHeight;
  } catch (err) { console.error(err); }
}

$("messageForm").onsubmit = async e => {
  e.preventDefault();
  const body = $("messageInput").value.trim();
  if (!body || !activeFriend) return;
  const button = $("messageForm").querySelector("button");
  button.disabled = true;
  try {
    await api("/api/messages", {
      method: "POST",
      body: JSON.stringify({ receiverId: activeFriend.id, body })
    });
    $("messageInput").value = "";
    await loadMessages();
  } catch (err) { alert(err.message); }
  finally { button.disabled = false; $("messageInput").focus(); }
};

(async function boot() {
  try {
    const data = await api("/api/me");
    currentUser = data.user;
    showApp();
  } catch (_) { /* signed out */ }
})();

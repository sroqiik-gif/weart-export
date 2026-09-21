const SUPABASE_URL = "https://cuzhlqetfjhdmkjjstim.supabase.co";
const API_KEY = "sb_publishable_gVLbDfUdPZ-zNoWj38e6DA_6Ii4Yxo3";
const SESSION_KEY = "weart_export_session_v5";

const $ = (id) => document.getElementById(id);

let session = null;
let currentUser = null;
let projects = [];
let clients = [];
let contacts = [];
let projectRecipients = [];
let projectInvoices = [];
let selectedClientId = null;
let editingProjectId = null;

window.addEventListener("error", (e) => {
  try { showToast("Chyba aplikácie: " + (e.message || "neznáma chyba")); } catch {}
});
window.addEventListener("unhandledrejection", (e) => {
  try { showToast("Chyba aplikácie: " + ((e.reason && e.reason.message) || "neznáma chyba")); } catch {}
});

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[c]));
}

function showToast(message) {
  const el = $("toast");
  if (!el) {
    alert(message);
    return;
  }
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
}

function saveSession() {
  if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else localStorage.removeItem(SESSION_KEY);
}

function loadStoredSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
  } catch {
    return null;
  }
}

async function publicRequest(url, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("apikey", API_KEY);
  if (typeof options.body === "string" && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(url, { ...options, headers });
  const text = await response.text();

  let data = null;
  try { data = text ? JSON.parse(text) : null; }
  catch { data = text; }

  if (!response.ok) {
    const err = new Error(
      (data && (data.message || data.error_description || data.error || data.msg)) ||
      ("HTTP " + response.status)
    );
    err.status = response.status;
    throw err;
  }

  return data;
}

async function refreshSession() {
  if (!session || !session.refresh_token) return false;
  try {
    session = await publicRequest(
      SUPABASE_URL + "/auth/v1/token?grant_type=refresh_token",
      {
        method: "POST",
        body: JSON.stringify({ refresh_token: session.refresh_token })
      }
    );
    currentUser = session.user || currentUser;
    saveSession();
    return true;
  } catch {
    session = null;
    currentUser = null;
    saveSession();
    return false;
  }
}

async function authedRequest(url, options = {}) {
  if (!session || !session.access_token) throw new Error("Nie si prihlásený.");

  async function doFetch() {
    const headers = new Headers(options.headers || {});
    headers.set("Authorization", "Bearer " + session.access_token);
    return publicRequest(url, { ...options, headers });
  }

  try {
    return await doFetch();
  } catch (err) {
    if ((err.status === 401 || err.status === 403) && await refreshSession()) {
      return doFetch();
    }
    throw err;
  }
}

function showAuth() {
  $("authView").classList.remove("hidden");
  $("appView").classList.add("hidden");
}

function showApp() {
  $("authView").classList.add("hidden");
  $("appView").classList.remove("hidden");
  $("userEmail").textContent = currentUser?.email || "";
}

async function login() {
  const email = $("authEmail").value.trim();
  const password = $("authPassword").value;

  if (!email || !password) {
    showToast("Zadaj e-mail a heslo.");
    return;
  }

  const button = $("loginBtn");
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "Prihlasujem…";

  try {
    session = await publicRequest(
      SUPABASE_URL + "/auth/v1/token?grant_type=password",
      {
        method: "POST",
        body: JSON.stringify({ email, password })
      }
    );

    currentUser = session.user;
    saveSession();
    showApp();

    try {
      await loadAll();
    } catch (err) {
      showToast("Prihlásenie prebehlo, ale údaje sa nenačítali: " + err.message);
    }
  } catch (err) {
    showToast(err.message || "Prihlásenie zlyhalo.");
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

async function logout() {
  session = null;
  currentUser = null;
  saveSession();
  showAuth();
}

function clientById(id) {
  return clients.find((c) => c.id === id);
}

function contactsForClient(id) {
  return contacts.filter((c) => c.client_id === id);
}

function recipientsForProject(id) {
  return projectRecipients.filter((r) => r.project_id === id);
}

function invoicesForProject(id) {
  return projectInvoices.filter((f) => f.project_id === id);
}

async function loadAll() {
  const result = await Promise.all([
    authedRequest(SUPABASE_URL + "/rest/v1/projects?select=*&order=created_at.desc"),
    authedRequest(SUPABASE_URL + "/rest/v1/clients?select=*&order=name.asc"),
    authedRequest(SUPABASE_URL + "/rest/v1/client_contacts?select=*&order=created_at.asc"),
    authedRequest(SUPABASE_URL + "/rest/v1/project_recipients?select=*"),
    authedRequest(SUPABASE_URL + "/rest/v1/project_invoices?select=*&order=created_at.asc")
  ]);

  projects = result[0] || [];
  clients = result[1] || [];
  contacts = result[2] || [];
  projectRecipients = result[3] || [];
  projectInvoices = result[4] || [];

  renderClientOptions();
  renderProjects();
  renderClients();
  renderClientDetail();
}

function renderClientOptions() {
  const current = $("projectClient").value;
  let html = '<option value="">Vyber klienta</option>';

  clients.forEach((c) => {
    html += '<option value="' + c.id + '">' + escapeHtml(c.name) + '</option>';
  });

  $("projectClient").innerHTML = html;
  if (current) $("projectClient").value = current;
}

function renderRecipientRows(container, clientId, selectedMap = new Map()) {
  if (!clientId) {
    container.innerHTML = '<div class="empty">Najprv vyber klienta.</div>';
    return;
  }

  const list = contactsForClient(clientId);
  if (!list.length) {
    container.innerHTML = '<div class="empty">Klient nemá uložený kontakt.</div>';
    return;
  }

  container.innerHTML = list.map((c) => {
    const checked = selectedMap.has(c.id) ? " checked" : "";
    const type = selectedMap.get(c.id) || "to";
    return (
      '<div class="recipient-row">' +
        '<input type="checkbox" data-contact="' + c.id + '"' + checked + '>' +
        '<div><strong>' + escapeHtml(c.name || "Bez mena") + '</strong>' +
        '<div class="small">' + escapeHtml(c.email) + '</div></div>' +
        '<select data-type="' + c.id + '">' +
          '<option value="to"' + (type === "to" ? " selected" : "") + '>TO</option>' +
          '<option value="cc"' + (type === "cc" ? " selected" : "") + '>CC</option>' +
        '</select>' +
      '</div>'
    );
  }).join("");
}

function syncLicenseFields(modeId, wrapId, dateId) {
  const manual = $(modeId).value === "manual";
  $(wrapId).classList.toggle("hidden", !manual);
  $(dateId).required = manual;
}

function formatDate(value) {
  if (!value) return "";
  return new Date(value + "T12:00:00").toLocaleDateString("sk-SK");
}

function recipientSummary(projectId) {
  const rows = recipientsForProject(projectId)
    .map((r) => ({ row: r, contact: contacts.find((c) => c.id === r.contact_id) }))
    .filter((x) => x.contact);

  const to = rows.filter((x) => x.row.recipient_type !== "cc").map((x) => x.contact.email);
  const cc = rows.filter((x) => x.row.recipient_type === "cc").map((x) => x.contact.email);

  let html = "";
  if (to.length) html += "<strong>TO:</strong> " + escapeHtml(to.join(", "));
  if (cc.length) html += (html ? "<br>" : "") + "<strong>CC:</strong> " + escapeHtml(cc.join(", "));
  return html;
}

function getProjectMode(p) {
  return p.delivery_mode || clientById(p.client_id)?.delivery_mode || "prepaid";
}

function renderProjects() {
  const root = $("projects");

  if (!projects.length) {
    root.innerHTML = '<div class="empty">Zatiaľ žiadne projekty.</div>';
    return;
  }

  root.innerHTML = projects.map((p) => {
    const files = invoicesForProject(p.id);
    const mode = getProjectMode(p);
    const framework = mode === "with_exports";
    const hasInvoiceNumber = !!String(p.invoice_number || "").trim();
    const hasLink = !!String(p.myairbridge_url || "").trim();
    const licenseReady = p.license_date_mode !== "manual" || !!p.license_manual_date;
    const billingReady = framework ? files.length > 0 : (hasInvoiceNumber && p.invoice_paid);
    const canSend = p.export_ready && hasLink && billingReady && licenseReady && !p.email_sent;

    const billingMeta = framework
      ? ("Rámcový • " + files.length + " PDF faktúr")
      : (hasInvoiceNumber ? ("Faktúra " + escapeHtml(p.invoice_number)) : "Faktúra nezadaná");

    const licenseMeta = p.license_effective_date
      ? ("Licencia od " + formatDate(p.license_effective_date))
      : (p.license_date_mode === "manual"
          ? ("Licencia od " + formatDate(p.license_manual_date))
          : "Licencia od dátumu odoslania");

    let states = '';
    states += '<span class="state ' + (p.export_ready ? "yes" : "no") + '">' +
      (p.export_ready ? "✓ Export pripravený" : "○ Export čaká") + '</span>';

    if (framework) {
      states += '<span class="state ' + (files.length ? "yes" : "no") + '">' +
        (files.length ? "✓ PDF faktúry" : "○ Chýba PDF") + '</span>';
      states += '<span class="state ' + (p.invoice_paid ? "yes" : "no") + '">' +
        (p.invoice_paid ? "✓ Uhradené" : "○ Úhrada čaká") + '</span>';
    } else {
      states += '<span class="state ' + (p.invoice_paid ? "yes" : "no") + '">' +
        (p.invoice_paid ? "✓ Uhradené" : "○ Neuhradené") + '</span>';
      if (!hasInvoiceNumber) states += '<span class="state no">○ Chýba faktúra</span>';
    }

    if (!hasLink) states += '<span class="state no">○ Chýba link</span>';
    if (p.email_sent) states += '<span class="state sent">✓ Odoslané</span>';

    return (
      '<article class="project">' +
        '<div class="project-top">' +
          '<div>' +
            '<div class="project-title">' + escapeHtml(p.project_name) + '</div>' +
            '<div class="meta">' + escapeHtml(p.client_name || "") + ' • ' + billingMeta +
            '<br>' + licenseMeta + '</div>' +
          '</div>' +
          '<button class="danger" data-a="delete" data-id="' + p.id + '">Odstrániť</button>' +
        '</div>' +
        (hasLink
          ? '<a class="link" href="' + escapeHtml(p.myairbridge_url) + '" target="_blank" rel="noopener">' +
              escapeHtml(p.myairbridge_url) + '</a>'
          : '') +
        '<div class="meta" style="margin-top:8px">' + recipientSummary(p.id) + '</div>' +
        '<div class="states">' + states + '</div>' +
        '<div class="actions">' +
          '<button class="' + (p.export_ready ? "danger" : "ok") + '" data-a="ready" data-id="' + p.id + '">' +
            (p.export_ready ? "Vrátiť export" : "Export pripravený") + '</button>' +
          '<button class="' + (p.invoice_paid ? "danger" : "warn") + '" data-a="paid" data-id="' + p.id + '"' +
            ((!framework && !hasInvoiceNumber) ? ' disabled' : '') + '>' +
            (p.invoice_paid ? "Vrátiť úhradu" : (framework ? "Faktúry uhradené" : "Faktúra uhradená")) +
          '</button>' +
          '<button class="ghost" data-a="invoices" data-id="' + p.id + '">Faktúry' +
            (files.length ? " (" + files.length + ")" : "") + '</button>' +
          '<button class="ghost" data-a="edit" data-id="' + p.id + '">Upraviť projekt</button>' +
          '<button class="ghost" data-a="recipients" data-id="' + p.id + '">Príjemcovia</button>' +
          '<button class="primary" data-a="send" data-id="' + p.id + '"' + (canSend ? "" : " disabled") + '>' +
            (p.email_sent ? "Odoslané" : "Odoslať klientovi") + '</button>' +
        '</div>' +
        (framework && !files.length
          ? '<div class="helper">Pred odoslaním nahraj aspoň jednu PDF faktúru. Úhrada odoslanie neblokuje.</div>'
          : '') +
        (p.note ? '<div class="small" style="margin-top:8px">Poznámka: ' + escapeHtml(p.note) + '</div>' : '') +
      '</article>'
    );
  }).join("");
}

async function createProject(e) {
  e.preventDefault();

  const clientId = $("projectClient").value;
  const client = clientById(clientId);
  if (!client) return showToast("Vyber klienta.");

  const checked = Array.from($("projectRecipients").querySelectorAll('input[type="checkbox"]:checked'));
  if (!checked.length) return showToast("Vyber aspoň jedného príjemcu.");

  const licenseMode = $("licenseMode").value;
  const manualDate = $("licenseManualDate").value;
  if (licenseMode === "manual" && !manualDate) return showToast("Vyber dátum licencie.");

  const rows = checked.map((cb) => {
    const type = $("projectRecipients").querySelector('select[data-type="' + cb.dataset.contact + '"]').value;
    return { contact_id: cb.dataset.contact, recipient_type: type };
  });

  const primary = rows.find((r) => r.recipient_type === "to") || rows[0];
  const primaryEmail = contacts.find((c) => c.id === primary.contact_id)?.email || "";

  try {
    const created = await authedRequest(SUPABASE_URL + "/rest/v1/projects", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        user_id: currentUser.id,
        project_name: $("projectName").value.trim(),
        client_id: clientId,
        client_name: client.name,
        client_email: primaryEmail,
        invoice_number: $("invoiceNumber").value.trim() || null,
        myairbridge_url: $("mabUrl").value.trim() || null,
        note: $("note").value.trim() || null,
        license_date_mode: licenseMode,
        license_manual_date: licenseMode === "manual" ? manualDate : null,
        delivery_mode: client.delivery_mode || "prepaid"
      })
    });

    const project = created?.[0];
    if (!project?.id) throw new Error("Projekt sa nevytvoril.");

    await authedRequest(SUPABASE_URL + "/rest/v1/project_recipients", {
      method: "POST",
      body: JSON.stringify(rows.map((r) => ({ ...r, project_id: project.id })))
    });

    e.target.reset();
    syncLicenseFields("licenseMode", "licenseManualWrap", "licenseManualDate");
    renderRecipientRows($("projectRecipients"), "");
    showToast("Projekt vytvorený.");
    await loadAll();
  } catch (err) {
    showToast(err.message);
  }
}

async function handleProjectAction(e) {
  const button = e.target.closest("button[data-a]");
  if (!button) return;

  const p = projects.find((x) => x.id === button.dataset.id);
  if (!p) return;

  const action = button.dataset.a;

  try {
    if (action === "delete") {
      if (!confirm('Odstrániť projekt „' + p.project_name + '“?')) return;
      await authedRequest(SUPABASE_URL + "/rest/v1/projects?id=eq." + p.id, { method: "DELETE" });
    } else if (action === "ready") {
      await authedRequest(SUPABASE_URL + "/rest/v1/projects?id=eq." + p.id, {
        method: "PATCH",
        body: JSON.stringify({ export_ready: !p.export_ready, updated_at: new Date().toISOString() })
      });
    } else if (action === "paid") {
      const framework = getProjectMode(p) === "with_exports";
      if (!framework && !p.invoice_number) return showToast("Najprv doplň faktúru.");

      await authedRequest(SUPABASE_URL + "/rest/v1/projects?id=eq." + p.id, {
        method: "PATCH",
        body: JSON.stringify({ invoice_paid: !p.invoice_paid, updated_at: new Date().toISOString() })
      });
    } else if (action === "edit") {
      openProjectEdit(p);
      return;
    } else if (action === "recipients") {
      openRecipients(p);
      return;
    } else if (action === "invoices") {
      openInvoices(p);
      return;
    } else if (action === "send") {
      button.disabled = true;
      button.textContent = "Odosielam…";
      const result = await authedRequest(SUPABASE_URL + "/functions/v1/send-export-email", {
        method: "POST",
        body: JSON.stringify({ project_id: p.id })
      });
      showToast("E-mail odoslaný" + (result.attachments ? (" s " + result.attachments + " PDF.") : "."));
    }

    await loadAll();
  } catch (err) {
    showToast(err.message);
    await loadAll();
  }
}

function openProjectEdit(p) {
  editingProjectId = p.id;
  $("editDeliveryMode").value = getProjectMode(p);
  $("editInvoice").value = p.invoice_number || "";
  $("editLink").value = p.myairbridge_url || "";
  $("editLicenseMode").value = p.license_date_mode || "send_date";
  $("editLicenseDate").value = p.license_manual_date || "";
  $("editNote").value = p.note || "";
  syncLicenseFields("editLicenseMode", "editLicenseDateWrap", "editLicenseDate");
  $("projectModal").classList.remove("hidden");
}

async function saveProjectEdit() {
  const p = projects.find((x) => x.id === editingProjectId);
  if (!p) return;

  const mode = $("editLicenseMode").value;
  const manualDate = $("editLicenseDate").value;
  if (mode === "manual" && !manualDate) return showToast("Vyber dátum.");

  try {
    await authedRequest(SUPABASE_URL + "/rest/v1/projects?id=eq." + p.id, {
      method: "PATCH",
      body: JSON.stringify({
        delivery_mode: $("editDeliveryMode").value,
        invoice_number: $("editInvoice").value.trim() || null,
        myairbridge_url: $("editLink").value.trim() || null,
        license_date_mode: mode,
        license_manual_date: mode === "manual" ? manualDate : null,
        note: $("editNote").value.trim() || null,
        updated_at: new Date().toISOString()
      })
    });
    $("projectModal").classList.add("hidden");
    editingProjectId = null;
    showToast("Projekt uložený.");
    await loadAll();
  } catch (err) {
    showToast(err.message);
  }
}

function openRecipients(p) {
  editingProjectId = p.id;
  const selected = new Map(recipientsForProject(p.id).map((r) => [r.contact_id, r.recipient_type]));
  renderRecipientRows($("modalRecipients"), p.client_id, selected);
  $("recipientModal").classList.remove("hidden");
}

async function saveRecipients() {
  const p = projects.find((x) => x.id === editingProjectId);
  if (!p) return;

  const checked = Array.from($("modalRecipients").querySelectorAll('input[type="checkbox"]:checked'));
  if (!checked.length) return showToast("Vyber príjemcu.");

  const rows = checked.map((cb) => ({
    project_id: p.id,
    contact_id: cb.dataset.contact,
    recipient_type: $("modalRecipients").querySelector('select[data-type="' + cb.dataset.contact + '"]').value
  }));

  try {
    await authedRequest(SUPABASE_URL + "/rest/v1/project_recipients?project_id=eq." + p.id, { method: "DELETE" });
    await authedRequest(SUPABASE_URL + "/rest/v1/project_recipients", {
      method: "POST",
      body: JSON.stringify(rows)
    });

    const primary = rows.find((r) => r.recipient_type === "to") || rows[0];
    const email = contacts.find((c) => c.id === primary.contact_id)?.email || p.client_email;

    await authedRequest(SUPABASE_URL + "/rest/v1/projects?id=eq." + p.id, {
      method: "PATCH",
      body: JSON.stringify({ client_email: email })
    });

    $("recipientModal").classList.add("hidden");
    editingProjectId = null;
    showToast("Príjemcovia uložen í.");
    await loadAll();
  } catch (err) {
    showToast(err.message);
  }
}

function renderClients() {
  const root = $("clientList");
  if (!clients.length) {
    root.innerHTML = '<div class="empty">Zatiaľ žiadny klient.</div>';
    return;
  }

  root.innerHTML = clients.map((c) => (
    '<button class="ghost ' + (selectedClientId === c.id ? "selected" : "") + '" data-client="' + c.id + '">' +
      '<strong>' + escapeHtml(c.name) + '</strong><br>' +
      '<span class="small">' +
        (c.delivery_mode === "with_exports"
          ? "Rámcový / faktúry s exportmi"
          : "Štandardný / po úhrade") +
        " • " + contactsForClient(c.id).length + " kontaktov" +
      '</span>' +
    '</button>'
  )).join("");
}

function renderClientDetail() {
  const c = clientById(selectedClientId);
  $("clientDetailEmpty").classList.toggle("hidden", !!c);
  $("clientDetail").classList.toggle("hidden", !c);

  if (!c) {
    $("clientDetailTitle").textContent = "Kontakty klienta";
    return;
  }

  $("clientDetailTitle").textContent = c.name;
  $("clientMode").value = c.delivery_mode || "prepaid";
  $("clientModeHelp").textContent =
    c.delivery_mode === "with_exports"
      ? "Exporty možno odoslať pred úhradou; PDF faktúry sa priložia k e-mailu."
      : "Exporty sa odošlú až po úhrade.";

  const list = contactsForClient(c.id);
  $("contactList").innerHTML = list.length
    ? list.map((x) => (
        '<div class="contact-item">' +
          '<div><strong>' + escapeHtml(x.name || "Bez mena") + '</strong>' +
          '<div class="small">' + escapeHtml(x.email) + '</div></div>' +
          '<button class="danger" data-del-contact="' + x.id + '">Odstrániť</button>' +
        '</div>'
      )).join("")
    : '<div class="empty">Žiadne kontakty.</div>';
}

async function createClient(e) {
  e.preventDefault();
  try {
    const created = await authedRequest(SUPABASE_URL + "/rest/v1/clients", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        user_id: currentUser.id,
        name: $("newClientName").value.trim(),
        delivery_mode: $("newClientMode").value
      })
    });

    selectedClientId = created?.[0]?.id || null;
    e.target.reset();
    showToast("Klient pridaný.");
    await loadAll();
  } catch (err) {
    showToast(err.message);
  }
}

async function saveClientMode() {
  const c = clientById(selectedClientId);
  if (!c) return;

  try {
    await authedRequest(SUPABASE_URL + "/rest/v1/clients?id=eq." + c.id, {
      method: "PATCH",
      body: JSON.stringify({ delivery_mode: $("clientMode").value })
    });
    showToast("Režim uložený.");
    await loadAll();
  } catch (err) {
    showToast(err.message);
  }
}

async function createContact(e) {
  e.preventDefault();
  const c = clientById(selectedClientId);
  if (!c) return showToast("Vyber klienta.");

  try {
    await authedRequest(SUPABASE_URL + "/rest/v1/client_contacts", {
      method: "POST",
      body: JSON.stringify({
        user_id: currentUser.id,
        client_id: c.id,
        name: $("contactName").value.trim() || null,
        email: $("contactEmail").value.trim()
      })
    });
    e.target.reset();
    showToast("Kontakt pridaný.");
    await loadAll();
  } catch (err) {
    showToast(err.message);
  }
}

async function storageRequest(path, options = {}) {
  async function doFetch() {
    const headers = new Headers(options.headers || {});
    headers.set("apikey", API_KEY);
    headers.set("Authorization", "Bearer " + session.access_token);
    return fetch(SUPABASE_URL + "/storage/v1" + path, { ...options, headers });
  }

  let response = await doFetch();
  if ((response.status === 401 || response.status === 403) && await refreshSession()) {
    response = await doFetch();
  }

  if (!response.ok) {
    let message = "HTTP " + response.status;
    try {
      const data = await response.json();
      message = data.message || data.error || message;
    } catch {}
    throw new Error(message);
  }

  return response;
}

function safeFileName(name) {
  return name.normalize("NFKD").replace(/[^\w.\-]+/g, "_").replace(/_+/g, "_").slice(-120);
}

function openInvoices(p) {
  editingProjectId = p.id;
  $("invoiceFilesInput").value = "";
  renderInvoiceFiles();
  $("invoiceModal").classList.remove("hidden");
}

function renderInvoiceFiles() {
  const list = invoicesForProject(editingProjectId);
  $("invoiceFileList").innerHTML = list.length
    ? list.map((f) => (
      '<div class="contact-item">' +
        '<div><strong>' + escapeHtml(f.file_name) + '</strong>' +
        '<div class="small">' + (f.file_size ? Math.round(f.file_size / 1024) + " KB" : "") + '</div></div>' +
        '<button class="danger" data-del-invoice="' + f.id + '">Odstrániť</button>' +
      '</div>'
    )).join("")
    : '<div class="empty">Bez priloženej faktúry.</div>';
}

async function uploadInvoices() {
  const p = projects.find((x) => x.id === editingProjectId);
  if (!p) return;

  const files = Array.from($("invoiceFilesInput").files || []);
  if (!files.length) return showToast("Vyber PDF.");

  if (files.some((f) => f.type !== "application/pdf" && !f.name.toLowerCase().endsWith(".pdf"))) {
    return showToast("Povolené sú iba PDF súbory.");
  }

  if (files.some((f) => f.size > 10 * 1024 * 1024)) {
    return showToast("Maximálna veľkosť je 10 MB na súbor.");
  }

  const button = $("uploadInvoicesBtn");
  button.disabled = true;
  button.textContent = "Nahrávam…";

  try {
    for (const file of files) {
      const path = currentUser.id + "/" + p.id + "/" + crypto.randomUUID() + "-" + safeFileName(file.name);
      const encodedPath = path.split("/").map(encodeURIComponent).join("/");

      await storageRequest("/object/project-invoices/" + encodedPath, {
        method: "POST",
        headers: { "Content-Type": "application/pdf", "x-upsert": "false" },
        body: file
      });

      try {
        await authedRequest(SUPABASE_URL + "/rest/v1/project_invoices", {
          method: "POST",
          body: JSON.stringify({
            user_id: currentUser.id,
            project_id: p.id,
            file_name: file.name,
            storage_path: path,
            mime_type: "application/pdf",
            file_size: file.size
          })
        });
      } catch (err) {
        try {
          await storageRequest("/object/project-invoices/" + encodedPath, { method: "DELETE" });
        } catch {}
        throw err;
      }
    }

    showToast(files.length === 1 ? "Faktúra nahraná." : (files.length + " faktúr nahraných."));
    await loadAll();
    renderInvoiceFiles();
    $("invoiceFilesInput").value = "";
  } catch (err) {
    showToast(err.message);
  } finally {
    button.disabled = false;
    button.textContent = "Nahrať faktúry";
  }
}

async function deleteInvoice(e) {
  const button = e.target.closest("[data-del-invoice]");
  if (!button) return;

  const f = projectInvoices.find((x) => x.id === button.dataset.delInvoice);
  if (!f) return;

  if (!confirm('Odstrániť „' + f.file_name + '“?')) return;

  try {
    await authedRequest(SUPABASE_URL + "/rest/v1/project_invoices?id=eq." + f.id, { method: "DELETE" });

    try {
      const encodedPath = f.storage_path.split("/").map(encodeURIComponent).join("/");
      await storageRequest("/object/project-invoices/" + encodedPath, { method: "DELETE" });
    } catch {}

    await loadAll();
    renderInvoiceFiles();
  } catch (err) {
    showToast(err.message);
  }
}

function bindEvents() {
  $("loginBtn").addEventListener("click", login);
  $("authPassword").addEventListener("keydown", (e) => { if (e.key === "Enter") login(); });
  $("logoutBtn").addEventListener("click", logout);
  $("refreshBtn").addEventListener("click", loadAll);

  document.querySelectorAll(".tab").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
      button.classList.add("active");
      $("projectsView").classList.toggle("hidden", button.dataset.view !== "projectsView");
      $("clientsView").classList.toggle("hidden", button.dataset.view !== "clientsView");
    });
  });

  $("projectClient").addEventListener("change", () => {
    renderRecipientRows($("projectRecipients"), $("projectClient").value);
  });

  $("licenseMode").addEventListener("change", () => syncLicenseFields("licenseMode", "licenseManualWrap", "licenseManualDate"));
  $("editLicenseMode").addEventListener("change", () => syncLicenseFields("editLicenseMode", "editLicenseDateWrap", "editLicenseDate"));

  $("projectForm").addEventListener("submit", createProject);
  $("projects").addEventListener("click", handleProjectAction);

  $("closeProjectModal").addEventListener("click", () => {
    $("projectModal").classList.add("hidden");
    editingProjectId = null;
  });
  $("saveProjectBtn").addEventListener("click", saveProjectEdit);

  $("closeRecipientModal").addEventListener("click", () => {
    $("recipientModal").classList.add("hidden");
    editingProjectId = null;
  });
  $("saveRecipientsBtn").addEventListener("click", saveRecipients);

  $("clientForm").addEventListener("submit", createClient);
  $("clientList").addEventListener("click", (e) => {
    const button = e.target.closest("[data-client]");
    if (!button) return;
    selectedClientId = button.dataset.client;
    renderClients();
    renderClientDetail();
  });

  $("saveClientModeBtn").addEventListener("click", saveClientMode);
  $("contactForm").addEventListener("submit", createContact);

  $("contactList").addEventListener("click", async (e) => {
    const button = e.target.closest("[data-del-contact]");
    if (!button) return;
    if (!confirm("Odstrániť kontakt?")) return;
    try {
      await authedRequest(SUPABASE_URL + "/rest/v1/client_contacts?id=eq." + button.dataset.delContact, { method: "DELETE" });
      await loadAll();
    } catch (err) {
      showToast(err.message);
    }
  });

  $("closeInvoiceModal").addEventListener("click", () => {
    $("invoiceModal").classList.add("hidden");
    editingProjectId = null;
  });
  $("uploadInvoicesBtn").addEventListener("click", uploadInvoices);
  $("invoiceFileList").addEventListener("click", deleteInvoice);
}

async function boot() {
  bindEvents();
  syncLicenseFields("licenseMode", "licenseManualWrap", "licenseManualDate");

  session = loadStoredSession();

  if (session?.refresh_token) {
    await refreshSession();
  }

  if (session?.access_token) {
    try {
      currentUser = await authedRequest(SUPABASE_URL + "/auth/v1/user");
      showApp();
      await loadAll();
      return;
    } catch {
      session = null;
      currentUser = null;
      saveSession();
    }
  }

  showAuth();
}

boot();
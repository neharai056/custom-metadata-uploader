const API_VERSION = "v60.0";

const els = {
  connStatus: document.getElementById("connStatus"),
  instanceUrl: document.getElementById("instanceUrl"),
  sessionId: document.getElementById("sessionId"),
  autoDetectBtn: document.getElementById("autoDetectBtn"),
  connectBtn: document.getElementById("connectBtn"),
  connectionMsg: document.getElementById("connectionMsg"),
  typeSection: document.getElementById("typeSection"),
  typeSelect: document.getElementById("typeSelect"),
  typeMsg: document.getElementById("typeMsg"),
  fieldsSection: document.getElementById("fieldsSection"),
  recordForm: document.getElementById("recordForm"),
  submitBtn: document.getElementById("submitBtn"),
  submitMsg: document.getElementById("submitMsg"),
  modeSingle: document.getElementById("modeSingle"),
  modeCsv: document.getElementById("modeCsv"),
  singleRecordBlock: document.getElementById("singleRecordBlock"),
  csvImportBlock: document.getElementById("csvImportBlock"),
  downloadTemplateBtn: document.getElementById("downloadTemplateBtn"),
  csvFile: document.getElementById("csvFile"),
  parseCsvBtn: document.getElementById("parseCsvBtn"),
  csvParseMsg: document.getElementById("csvParseMsg"),
  csvPreviewWrap: document.getElementById("csvPreviewWrap"),
  csvPreviewTable: document.getElementById("csvPreviewTable"),
  importCsvBtn: document.getElementById("importCsvBtn"),
  csvImportMsg: document.getElementById("csvImportMsg"),
  csvResultsRow: document.getElementById("csvResultsRow"),
  downloadResultsBtn: document.getElementById("downloadResultsBtn"),
  debugLog: document.getElementById("debugLog"),
  copyDebugBtn: document.getElementById("copyDebugBtn"),
  authExample: document.getElementById("authExample"),
  copyAuthBtn: document.getElementById("copyAuthBtn"),
};

let state = {
  instanceUrl: "",
  sessionId: "",
  fields: [],
  selectedType: "",
  csvRows: [], // parsed row objects, in submission order
  csvColumns: [], // header columns as found in the CSV
  csvResults: [], // per-row {row, status, message}
  debugLines: [],
};

// ---------- helpers ----------

function addDebugLog(message) {
  const stamp = new Date().toLocaleTimeString();
  const line = `[${stamp}] ${message}`;
  state.debugLines.push(line);
  if (state.debugLines.length > 80) {
    state.debugLines = state.debugLines.slice(-80);
  }
  if (els.debugLog) {
    els.debugLog.textContent = state.debugLines.join("\n");
  }
}

function setStatus(kind, text) {
  els.connStatus.className = `status status--${kind}`;
  els.connStatus.textContent = text;
}

function syncSessionState() {
  state.instanceUrl = normalizeInstanceUrl(els.instanceUrl.value.trim());
  state.sessionId = els.sessionId.value.trim();
  refreshAuthExample();
}

function refreshAuthExample() {
  if (!els.authExample) return;
  const instanceUrl = normalizeInstanceUrl(els.instanceUrl.value.trim()) || "https://your-org.my.salesforce.com";
  const sessionId = els.sessionId.value.trim() || "YOUR_SESSION_ID";
  const payload = JSON.stringify({ MasterLabel: "dfggg", DeveloperName: "ggg", Case_name__c: "ggg" });
  const curl = `curl -X POST "${instanceUrl}/services/data/${API_VERSION}/sobjects/Booking_Config__mdt/" \\
  -H "Authorization: Bearer ${sessionId}" \\
  -H "Content-Type: application/json" \\
  -d '${payload}'`;
  els.authExample.textContent = curl;
}

function setMsg(el, text, kind) {
  el.textContent = text || "";
  el.className = "msg" + (kind ? ` ${kind}` : "");
}

function normalizeInstanceUrl(url) {
  if (!url) return "";
  return url.replace(/\/+$/, "");
}

async function sfFetch(path, options = {}) {
  const url = `${state.instanceUrl}${path}`;
  addDebugLog(`Request -> ${options.method || "GET"} ${path}`);
  const resp = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${state.sessionId}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  const text = await resp.text().catch(() => "");
  addDebugLog(`Response <- ${resp.status} ${path} ${text.slice(0, 220)}`);
  return new Response(text, {
    status: resp.status,
    statusText: resp.statusText,
    headers: resp.headers,
  });
}

async function createRecord(typeName, record) {
  const endpoints = [
    `/services/data/${API_VERSION}/sobjects/${encodeURIComponent(typeName)}/`,
    `/services/data/${API_VERSION}/sobjects/${encodeURIComponent(typeName)}`,
  ];

  let lastResult = null;

  for (const endpoint of endpoints) {
    const resp = await sfFetch(endpoint, {
      method: "POST",
      body: JSON.stringify(record),
    });
    const body = await resp.json().catch(() => null);

    if (resp.ok && body && body.success) {
      return { resp, body };
    }

    lastResult = { resp, body };

    if (resp.status !== 400 && resp.status !== 404) {
      break;
    }
  }

  return lastResult;
}

// ---------- step 1: connection ----------

async function autoDetectFromActiveTab() {
  setMsg(els.connectionMsg, "Detecting active tab...");
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    addDebugLog(`Auto-detect tab: ${tab && tab.url ? tab.url : "none"}`);
    if (!tab || !tab.url) throw new Error("No active tab found.");
    const tabUrl = new URL(tab.url);
    const hostname = tabUrl.hostname;

    const isSalesforceHost =
      /salesforce\.com$|force\.com$|salesforce-setup\.com$|salesforce-sites\.com$/.test(hostname);

    if (!isSalesforceHost) {
      addDebugLog(`Auto-detect rejected host: ${hostname}`);
      setMsg(
        els.connectionMsg,
        "Active tab doesn't look like a Salesforce page. Enter instance URL and session manually.",
        "error"
      );
      return;
    }

    const apiHostname = hostname.replace(/\.salesforce-setup\.com$/, ".salesforce.com");
    const instanceUrl = `${tabUrl.protocol}//${apiHostname}`;
    els.instanceUrl.value = instanceUrl;

    // Try to find the 'sid' session cookie for this host (and parent domain).
    const cookies = await chrome.cookies.getAll({ domain: hostname });
    let sidCookie = cookies.find((c) => c.name === "sid");

    if (!sidCookie) {
      // try without subdomain (some orgs set cookie on parent domain)
      const parts = hostname.split(".");
      if (parts.length > 2) {
        const parentDomain = parts.slice(1).join(".");
        const parentCookies = await chrome.cookies.getAll({ domain: parentDomain });
        sidCookie = parentCookies.find((c) => c.name === "sid");
      }
    }

    if (sidCookie) {
      addDebugLog(`Auto-detect found sid cookie on ${hostname}`);
      els.sessionId.value = sidCookie.value;
      syncSessionState();
      setMsg(els.connectionMsg, "Detected instance URL and session. Click Connect.");
    } else {
      setMsg(
        els.connectionMsg,
        "Found instance URL but couldn't read the session cookie automatically. Paste a session ID / access token manually.",
        "error"
      );
    }
  } catch (err) {
    setMsg(els.connectionMsg, `Auto-detect failed: ${err.message}`, "error");
  }
}

async function connect() {
  const instanceUrl = normalizeInstanceUrl(els.instanceUrl.value.trim());
  addDebugLog(`Connect clicked with instance: ${instanceUrl}`);
  const sessionId = els.sessionId.value.trim();
  state.instanceUrl = instanceUrl;
  state.sessionId = sessionId;

  if (!instanceUrl || !sessionId) {
    setMsg(els.connectionMsg, "Instance URL and session/token are both required.", "error");
    return;
  }

  setMsg(els.connectionMsg, "Validating connection...");
  els.connectBtn.disabled = true;

  try {
    const resp = await sfFetch(`/services/data/${API_VERSION}/sobjects/`);
    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`HTTP ${resp.status}: ${body.slice(0, 200)}`);
    }
    const data = await resp.json();
    addDebugLog(`Connected successfully; discovered ${data.sobjects ? data.sobjects.length : 0} sobjects`);
    setStatus("ok", "Connected");
    setMsg(els.connectionMsg, "Connected successfully.", "success");

    const mdtTypes = data.sobjects
      .filter((s) => s.name.endsWith("__mdt"))
      .map((s) => ({ name: s.name, label: s.label }))
      .sort((a, b) => a.label.localeCompare(b.label));

    populateTypeDropdown(mdtTypes);
    els.typeSection.hidden = false;
  } catch (err) {
    setStatus("error", "Connection failed");
    setMsg(els.connectionMsg, `Connection failed: ${err.message}`, "error");
    els.typeSection.hidden = true;
    els.fieldsSection.hidden = true;
  } finally {
    els.connectBtn.disabled = false;
  }
}

// ---------- step 2: pick metadata type ----------

function populateTypeDropdown(types) {
  els.typeSelect.innerHTML = '<option value="">-- Select a type --</option>';
  for (const t of types) {
    const opt = document.createElement("option");
    opt.value = t.name;
    opt.textContent = `${t.label} (${t.name})`;
    els.typeSelect.appendChild(opt);
  }
  if (types.length === 0) {
    setMsg(els.typeMsg, "No Custom Metadata Types (__mdt) found in this org.", "error");
  } else {
    setMsg(els.typeMsg, `${types.length} custom metadata type(s) found.`);
  }
}

async function onTypeSelected() {
  const typeName = els.typeSelect.value;
  state.selectedType = typeName;
  els.fieldsSection.hidden = true;
  els.recordForm.innerHTML = "";
  resetCsvUi();

  if (!typeName) return;

  setMsg(els.typeMsg, "Loading field metadata...");
  try {
    const resp = await sfFetch(`/services/data/${API_VERSION}/sobjects/${typeName}/describe/`);
    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`HTTP ${resp.status}: ${body.slice(0, 200)}`);
    }
    const describe = await resp.json();
    addDebugLog(`Loaded describe for ${typeName}; fields=${describe.fields ? describe.fields.length : 0}`);

    // Fields we don't want to show / can't set directly.
    const excluded = new Set([
      "Id",
      "DeveloperName", // handled specially below as required field
      "MasterLabel", // handled specially below as required field
      "NamespacePrefix",
      "Language",
      "QualifiedApiName",
      "Label",
    ]);

    const relevantFields = describe.fields.filter((f) => !excluded.has(f.name) && !isExcludedInsertField(f.name));

    state.fields = relevantFields;
    renderForm(relevantFields);
    setMsg(els.typeMsg, `Loaded ${relevantFields.length + 2} field(s).`, "success");
    els.fieldsSection.hidden = false;
  } catch (err) {
    setMsg(els.typeMsg, `Failed to load fields: ${err.message}`, "error");
  }
}

// ---------- step 3: dynamic form ----------

function renderForm(fields) {
  els.recordForm.innerHTML = "";

  // Always-required custom metadata fields
  els.recordForm.appendChild(
    buildFieldBlock({
      name: "MasterLabel",
      label: "Label",
      type: "string",
      length: 40,
      nillable: false,
      inlineHelpText: "Display label for this record (max 40 chars).",
    })
  );
  els.recordForm.appendChild(
    buildFieldBlock({
      name: "DeveloperName",
      label: "Name (Developer Name)",
      type: "string",
      length: 40,
      nillable: false,
      inlineHelpText: "API name, no spaces (max 40 chars).",
    })
  );

  for (const field of fields) {
    els.recordForm.appendChild(buildFieldBlock(field));
  }
}

function buildFieldBlock(field) {
  const wrapper = document.createElement("div");
  wrapper.className = "field-block";

  const label = document.createElement("label");
  label.setAttribute("for", `f_${field.name}`);
  label.textContent = field.label + (field.nillable === false ? " *" : "");

  let input;

  if (field.type === "boolean") {
    const row = document.createElement("div");
    row.className = "checkbox-row";
    input = document.createElement("input");
    input.type = "checkbox";
    input.id = `f_${field.name}`;
    row.appendChild(input);
    const span = document.createElement("span");
    span.textContent = field.label;
    row.appendChild(span);
    label.textContent = ""; // checkbox already labeled inline
    wrapper.appendChild(row);
    if (field.inlineHelpText) {
      const hint = document.createElement("span");
      hint.className = "field-hint";
      hint.textContent = field.inlineHelpText;
      wrapper.appendChild(hint);
    }
    input.dataset.fieldName = field.name;
    input.dataset.fieldType = field.type;
    return wrapper;
  }

  if (field.type === "picklist" && field.picklistValues && field.picklistValues.length) {
    input = document.createElement("select");
    input.id = `f_${field.name}`;
    const blank = document.createElement("option");
    blank.value = "";
    blank.textContent = "-- none --";
    input.appendChild(blank);
    for (const pv of field.picklistValues) {
      if (!pv.active) continue;
      const opt = document.createElement("option");
      opt.value = pv.value;
      opt.textContent = pv.label;
      input.appendChild(opt);
    }
  } else if (field.type === "textarea") {
    input = document.createElement("textarea");
    input.id = `f_${field.name}`;
  } else if (field.type === "int" || field.type === "double" || field.type === "currency" || field.type === "percent") {
    input = document.createElement("input");
    input.type = "number";
    if (field.type !== "int") input.step = "any";
    input.id = `f_${field.name}`;
  } else {
    input = document.createElement("input");
    input.type = "text";
    input.id = `f_${field.name}`;
    if (field.length) input.maxLength = field.length;
  }

  input.dataset.fieldName = field.name;
  input.dataset.fieldType = field.type;

  wrapper.appendChild(label);
  wrapper.appendChild(input);

  if (field.inlineHelpText) {
    const hint = document.createElement("span");
    hint.className = "field-hint";
    hint.textContent = field.inlineHelpText;
    wrapper.appendChild(hint);
  }

  return wrapper;
}

function collectFormValues() {
  const inputs = els.recordForm.querySelectorAll("[data-field-name]");
  const record = {};
  for (const input of inputs) {
    const name = input.dataset.fieldName;
    const type = input.dataset.fieldType;

    if (type === "boolean") {
      record[name] = !!input.checked;
      continue;
    }

    const raw = input.value;
    if (raw === "" || raw === null) continue; // omit empty optional fields

    if (type === "int") {
      record[name] = parseInt(raw, 10);
    } else if (type === "double" || type === "currency" || type === "percent") {
      record[name] = parseFloat(raw);
    } else {
      record[name] = raw;
    }
  }
  return record;
}

// ---------- step 4: submit ----------

async function submitRecord() {
  if (!state.selectedType) {
    setMsg(els.submitMsg, "Select a custom metadata type first.", "error");
    return;
  }

  const record = collectFormValues();
  addDebugLog(`Single insert payload for ${state.selectedType}: ${JSON.stringify(record)}`);

  if (!record.MasterLabel || !record.DeveloperName) {
    setMsg(els.submitMsg, "Label and Name (Developer Name) are required.", "error");
    return;
  }

  els.submitBtn.disabled = true;
  setMsg(els.submitMsg, "Inserting record...");

  try {
    const { resp, body } = await createRecord(state.selectedType, record);

    if (resp.ok && body && body.success) {
      setMsg(els.submitMsg, `Record created successfully. Id: ${body.id}`, "success");
    } else {
      const errText = explainInsertFailure(formatSfErrorMessage(body, "Unknown Salesforce error"));
      addDebugLog(`Single insert failed: ${errText}`);
      setMsg(els.submitMsg, `Insert failed:\n${errText}`, "error");
    }
  } catch (err) {
    setMsg(els.submitMsg, `Insert failed: ${err.message}`, "error");
  } finally {
    els.submitBtn.disabled = false;
  }
}

// ---------- mode toggle ----------

function toggleMode() {
  const csvMode = els.modeCsv.checked;
  els.singleRecordBlock.hidden = csvMode;
  els.csvImportBlock.hidden = !csvMode;
}

function resetCsvUi() {
  state.csvRows = [];
  state.csvColumns = [];
  state.csvResults = [];
  els.csvFile.value = "";
  els.csvPreviewWrap.hidden = true;
  els.csvPreviewTable.innerHTML = "";
  els.csvResultsRow.hidden = true;
  setMsg(els.csvParseMsg, "");
  setMsg(els.csvImportMsg, "");
}

// ---------- CSV template ----------

const excludedFromInsert = new Set(["SystemModstamp", "LastModifiedDate", "LastModifiedById", "CreatedDate", "CreatedById"]);

function isExcludedInsertField(name) {
  return excludedFromInsert.has(name);
}

function getAllInsertableFieldNames() {
  return ["MasterLabel", "DeveloperName", ...state.fields.filter((f) => !isExcludedInsertField(f.name)).map((f) => f.name)];
}

function fieldTypeOf(name) {
  if (name === "MasterLabel" || name === "DeveloperName") return "string";
  const f = state.fields.find((f) => f.name === name);
  return f ? f.type : "string";
}

function downloadCsvTemplate() {
  if (!state.selectedType) return;
  const columns = getAllInsertableFieldNames();
  const csv = columns.map(csvEscape).join(",") + "\n";
  triggerDownload(csv, `${state.selectedType}_template.csv`, "text/csv");
}

function triggerDownload(text, filename, mime) {
  const blob = new Blob([text], { type: mime || "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function csvEscape(value) {
  const s = value === undefined || value === null ? "" : String(value);
  if (/[",\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function formatSfErrorMessage(body, fallback = "Unknown Salesforce error") {
  if (!body) return fallback;

  if (typeof body === "string") return body;

  if (Array.isArray(body)) {
    return body.map((e) => `${e.errorCode || "ERROR"}: ${e.message || JSON.stringify(e)}`).join(" | ");
  }

  if (typeof body === "object") {
    if (body.message) return body.message;
    if (body.errorCode && body.message) return `${body.errorCode}: ${body.message}`;
    if (body.error_description) return body.error_description;
  }

  return fallback;
}

function explainInsertFailure(message) {
  if (!message) return message;

  const lower = message.toLowerCase();
  if (/cannot_insert_update_activate_entity|entity type cannot be inserted|not insertable|not creatable|insufficient access/i.test(lower)) {
    return `${message}\nThis usually means a trigger/flow, permission issue, or org-level restriction is blocking inserts for this Custom Metadata Type.`;
  }
  return message;
}

// ---------- CSV parsing (handles quoted fields, embedded commas/newlines) ----------

function parseCsvText(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  const src = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];

    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  while (rows.length && rows[rows.length - 1].every((c) => c.trim() === "")) {
    rows.pop();
  }

  if (rows.length === 0) return { headers: [], records: [] };

  const headers = rows[0].map((h) => h.trim());
  const records = rows.slice(1).map((r) => {
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = r[idx] !== undefined ? r[idx] : "";
    });
    return obj;
  });

  return { headers, records };
}

async function handleParseCsv() {
  const file = els.csvFile.files && els.csvFile.files[0];
  if (!file) {
    setMsg(els.csvParseMsg, "Choose a CSV file first.", "error");
    return;
  }
  if (!state.selectedType) {
    setMsg(els.csvParseMsg, "Select a custom metadata type first.", "error");
    return;
  }

  const text = await file.text();
  const { headers, records } = parseCsvText(text);

  if (records.length === 0) {
    setMsg(els.csvParseMsg, "No data rows found in that CSV.", "error");
    return;
  }

  const knownFields = new Set(getAllInsertableFieldNames());
  const unknownColumns = headers.filter((h) => !knownFields.has(h));
  const missingRequired = ["MasterLabel", "DeveloperName"].filter(
    (req) => !headers.includes(req)
  );

  if (missingRequired.length) {
    setMsg(
      els.csvParseMsg,
      `CSV is missing required column(s): ${missingRequired.join(", ")}.`,
      "error"
    );
    els.csvPreviewWrap.hidden = true;
    return;
  }

  state.csvColumns = headers;
  state.csvRows = records;
  state.csvResults = records.map(() => ({ status: "pending", message: "" }));

  renderCsvPreview();

  let msg = `Parsed ${records.length} row(s), ${headers.length} column(s).`;
  if (unknownColumns.length) {
    msg += ` Note: column(s) not recognized on this type and will be ignored: ${unknownColumns.join(", ")}.`;
  }
  setMsg(els.csvParseMsg, msg);
  els.csvPreviewWrap.hidden = false;
  els.csvResultsRow.hidden = true;
  setMsg(els.csvImportMsg, "");
}

function renderCsvPreview() {
  const table = els.csvPreviewTable;
  table.innerHTML = "";

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  ["#", ...state.csvColumns, "Status"].forEach((h) => {
    const th = document.createElement("th");
    th.textContent = h;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  state.csvRows.forEach((rec, idx) => {
    const tr = document.createElement("tr");
    tr.id = `csvrow_${idx}`;

    const idxCell = document.createElement("td");
    idxCell.textContent = idx + 1;
    tr.appendChild(idxCell);

    state.csvColumns.forEach((col) => {
      const td = document.createElement("td");
      td.textContent = rec[col];
      tr.appendChild(td);
    });

    const statusCell = document.createElement("td");
    statusCell.className = "status-pending";
    statusCell.textContent = "Pending";
    statusCell.id = `csvstatus_${idx}`;
    tr.appendChild(statusCell);

    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
}

function coerceCsvValue(name, rawValue) {
  const type = fieldTypeOf(name);
  const raw = (rawValue ?? "").trim();
  if (raw === "") return undefined;

  if (type === "boolean") {
    return ["true", "1", "yes", "y"].includes(raw.toLowerCase());
  }
  if (type === "int") {
    const n = parseInt(raw, 10);
    return Number.isNaN(n) ? undefined : n;
  }
  if (type === "double" || type === "currency" || type === "percent") {
    const n = parseFloat(raw);
    return Number.isNaN(n) ? undefined : n;
  }
  return raw;
}

function csvRowToRecord(rec) {
  const record = {};
  const knownFields = new Set(getAllInsertableFieldNames());
  for (const col of state.csvColumns) {
    if (!knownFields.has(col)) continue;
    const value = coerceCsvValue(col, rec[col]);
    if (value !== undefined) record[col] = value;
  }
  return record;
}

async function importAllCsvRows() {
  if (!state.csvRows.length || !state.selectedType) return;

  els.importCsvBtn.disabled = true;
  els.csvResultsRow.hidden = true;
  let successCount = 0;
  let errorCount = 0;

  for (let idx = 0; idx < state.csvRows.length; idx++) {
    const statusCell = document.getElementById(`csvstatus_${idx}`);
    setMsg(
      els.csvImportMsg,
      `Importing row ${idx + 1} of ${state.csvRows.length}... (${successCount} succeeded, ${errorCount} failed so far)`
    );

    const record = csvRowToRecord(state.csvRows[idx]);
    addDebugLog(`CSV row ${idx + 1} payload: ${JSON.stringify(record)}`);

    if (!record.MasterLabel || !record.DeveloperName) {
      state.csvResults[idx] = { status: "error", message: "Missing Label or Name" };
      if (statusCell) {
        statusCell.className = "status-error";
        statusCell.textContent = "Error: missing Label/Name";
      }
      errorCount++;
      continue;
    }

    try {
      const { resp, body } = await createRecord(state.selectedType, record);

      if (resp.ok && body && body.success) {
        addDebugLog(`CSV row ${idx + 1} success: ${JSON.stringify(body)}`);
        state.csvResults[idx] = { status: "success", message: `Id: ${body.id}` };
        if (statusCell) {
          statusCell.className = "status-success";
          statusCell.textContent = `Success (${body.id})`;
        }
        successCount++;
      } else {
        const errText = explainInsertFailure(formatSfErrorMessage(body, "Unknown Salesforce error"));
        addDebugLog(`CSV row ${idx + 1} failed: ${errText}`);
        state.csvResults[idx] = { status: "error", message: errText };
        if (statusCell) {
          statusCell.className = "status-error";
          statusCell.textContent = "Error";
          statusCell.title = errText;
        }
        errorCount++;
      }
    } catch (err) {
      state.csvResults[idx] = { status: "error", message: err.message };
      if (statusCell) {
        statusCell.className = "status-error";
        statusCell.textContent = "Error";
        statusCell.title = err.message;
      }
      errorCount++;
    }
  }

  setMsg(
    els.csvImportMsg,
    `Done. ${successCount} succeeded, ${errorCount} failed out of ${state.csvRows.length}.`,
    errorCount ? "error" : "success"
  );
  els.csvResultsRow.hidden = false;
  els.importCsvBtn.disabled = false;
}

function downloadResultsLog() {
  const header = ["Row", ...state.csvColumns, "Status", "Message"];
  const lines = [header.map(csvEscape).join(",")];

  state.csvRows.forEach((rec, idx) => {
    const result = state.csvResults[idx] || { status: "", message: "" };
    const cells = [
      idx + 1,
      ...state.csvColumns.map((c) => rec[c]),
      result.status,
      result.message,
    ];
    lines.push(cells.map(csvEscape).join(","));
  });

  triggerDownload(lines.join("\n"), `${state.selectedType}_import_results.csv`, "text/csv");
}

// ---------- wire up ----------

els.autoDetectBtn.addEventListener("click", autoDetectFromActiveTab);
els.connectBtn.addEventListener("click", connect);
els.typeSelect.addEventListener("change", onTypeSelected);
els.submitBtn.addEventListener("click", (e) => {
  e.preventDefault();
  submitRecord();
});
els.modeSingle.addEventListener("change", toggleMode);
els.modeCsv.addEventListener("change", toggleMode);
els.downloadTemplateBtn.addEventListener("click", downloadCsvTemplate);
els.parseCsvBtn.addEventListener("click", handleParseCsv);
els.importCsvBtn.addEventListener("click", importAllCsvRows);
els.downloadResultsBtn.addEventListener("click", downloadResultsLog);
els.copyDebugBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(state.debugLines.join("\n"));
    setMsg(els.connectionMsg, "Debug log copied to clipboard.", "success");
  } catch (err) {
    setMsg(els.connectionMsg, `Could not copy debug log: ${err.message}`, "error");
  }
});
els.copyAuthBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(els.authExample.textContent || "");
    setMsg(els.connectionMsg, "Auth example copied to clipboard.", "success");
  } catch (err) {
    setMsg(els.connectionMsg, `Could not copy auth example: ${err.message}`, "error");
  }
});

[els.instanceUrl, els.sessionId].forEach((el) => {
  el.addEventListener("input", syncSessionState);
});

syncSessionState();

// Try auto-detect on popup open for convenience.
autoDetectFromActiveTab();

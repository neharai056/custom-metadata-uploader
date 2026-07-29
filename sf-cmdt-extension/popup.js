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
};

let state = {
  instanceUrl: "",
  sessionId: "",
  fields: [],
  selectedType: "",
};

// ---------- helpers ----------

function setStatus(kind, text) {
  els.connStatus.className = `status status--${kind}`;
  els.connStatus.textContent = text;
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
  const resp = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${state.sessionId}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  return resp;
}

// ---------- step 1: connection ----------

async function autoDetectFromActiveTab() {
  setMsg(els.connectionMsg, "Detecting active tab...");
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) throw new Error("No active tab found.");
    const tabUrl = new URL(tab.url);
    const hostname = tabUrl.hostname;

    if (!/salesforce\.com$|force\.com$/.test(hostname)) {
      setMsg(
        els.connectionMsg,
        "Active tab doesn't look like a Salesforce page. Enter instance URL and session manually.",
        "error"
      );
      return;
    }

    const instanceUrl = `${tabUrl.protocol}//${hostname}`;
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
      els.sessionId.value = sidCookie.value;
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
  const sessionId = els.sessionId.value.trim();

  if (!instanceUrl || !sessionId) {
    setMsg(els.connectionMsg, "Instance URL and session/token are both required.", "error");
    return;
  }

  state.instanceUrl = instanceUrl;
  state.sessionId = sessionId;

  setMsg(els.connectionMsg, "Validating connection...");
  els.connectBtn.disabled = true;

  try {
    const resp = await sfFetch(`/services/data/${API_VERSION}/sobjects/`);
    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`HTTP ${resp.status}: ${body.slice(0, 200)}`);
    }
    const data = await resp.json();
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

  if (!typeName) return;

  setMsg(els.typeMsg, "Loading field metadata...");
  try {
    const resp = await sfFetch(`/services/data/${API_VERSION}/sobjects/${typeName}/describe/`);
    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`HTTP ${resp.status}: ${body.slice(0, 200)}`);
    }
    const describe = await resp.json();

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

    const editableFields = describe.fields.filter(
      (f) => f.createable && !excluded.has(f.name)
    );

    state.fields = editableFields;
    renderForm(editableFields);
    setMsg(els.typeMsg, `Loaded ${editableFields.length + 2} editable field(s).`, "success");
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

  if (!record.MasterLabel || !record.DeveloperName) {
    setMsg(els.submitMsg, "Label and Name (Developer Name) are required.", "error");
    return;
  }

  els.submitBtn.disabled = true;
  setMsg(els.submitMsg, "Inserting record...");

  try {
    const resp = await sfFetch(`/services/data/${API_VERSION}/sobjects/${state.selectedType}/`, {
      method: "POST",
      body: JSON.stringify(record),
    });

    const body = await resp.json().catch(() => null);

    if (resp.ok && body && body.success) {
      setMsg(els.submitMsg, `Record created successfully. Id: ${body.id}`, "success");
    } else {
      const errText = Array.isArray(body)
        ? body.map((e) => `${e.errorCode}: ${e.message}`).join("\n")
        : JSON.stringify(body);
      setMsg(els.submitMsg, `Insert failed:\n${errText}`, "error");
    }
  } catch (err) {
    setMsg(els.submitMsg, `Insert failed: ${err.message}`, "error");
  } finally {
    els.submitBtn.disabled = false;
  }
}

// ---------- wire up ----------

els.autoDetectBtn.addEventListener("click", autoDetectFromActiveTab);
els.connectBtn.addEventListener("click", connect);
els.typeSelect.addEventListener("change", onTypeSelected);
els.submitBtn.addEventListener("click", (e) => {
  e.preventDefault();
  submitRecord();
});

// Try auto-detect on popup open for convenience.
autoDetectFromActiveTab();

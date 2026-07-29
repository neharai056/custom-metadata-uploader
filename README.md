# Salesforce Custom Metadata Inserter (Chrome Extension)

Insert Custom Metadata Type (`__mdt`) records into a Salesforce org directly from
your browser, using the REST API.

## Install (unpacked, for dev/personal use)

1. Unzip this folder somewhere on disk.
2. Open Chrome and go to `chrome://extensions`.
3. Enable **Developer mode** (top right).
4. Click **Load unpacked** and select the `sf-cmdt-extension` folder.
5. Pin the extension from the toolbar for easy access.

## Usage

1. Open a tab logged into the Salesforce org you want to insert records into
   (Lightning, Classic, or Setup all work).
2. Click the extension icon.
3. Click **Auto-detect from active tab** — this tries to read the instance URL
   and your session cookie (`sid`) from that tab.
   - If auto-detect can't read the cookie (some orgs restrict this, or you're
     on a Lightning domain that doesn't expose it), paste an access token
     manually instead — e.g. copy `sid` from DevTools → Application → Cookies,
     or use a token from a connected app / Postman / SFDX (`sf org display --json`).
4. Click **Connect**. On success, the extension loads every Custom Metadata
   Type in the org.
5. Pick a type from the dropdown — the extension calls that type's `describe`
   and builds a form from its editable fields automatically (text, number,
   checkbox, and picklist fields are all handled).
6. Fill in **Label** and **Name** (required for every custom metadata record)
   plus any custom fields, then click **Insert Record**.
7. The new record's Id is shown on success, or the Salesforce error message on
   failure (e.g. validation rule, required field, FLS).

### Bulk import via CSV

- Switch the mode to **Bulk import (CSV)** after selecting a custom metadata type.
- Download the template, fill it with field API names, and include **MasterLabel**
  and **DeveloperName** on every row.
- Select the CSV file, then click **Parse & Preview**.
- Review the preview, then click **Import All Rows**.
- Optionally download the results log after import.

## How it works

- Uses the standard REST API (`/services/data/vXX.0/sobjects/...`), not the
  SOAP Metadata API — this is the same mechanism Salesforce uses to let Custom
  Metadata be managed like data records once "Manage" access is granted on
  the type.
- Authenticates with a Bearer token — either your active session cookie
  (auto-detected) or any valid session ID / OAuth access token you paste in.
- No data is sent anywhere except directly from your browser to your own
  Salesforce instance. There's no backend server involved.

## Requirements / permissions

- You need **Customize Application** (or equivalent) permission in the org,
  and "Manage" access on the specific custom metadata type, to insert records.
- The extension requests `cookies`, `activeTab`, and `storage` permissions,
  and host permissions for `*.salesforce.com` / `*.force.com` so it can read
  the session cookie and call the REST API.

## Notes & limitations

- Lookup/reference-type custom metadata fields expect the field's API name
  with the related record's `DeveloperName` value in most cases — check your
  field's describe if a lookup insert fails.
- Rich text / long text area fields render as plain `<textarea>` (no rich
  formatting).
- This is unpacked/dev-only as written; it isn't published to the Chrome Web
  Store, so each teammate would need to load it locally, or you can package
  and privately distribute it.

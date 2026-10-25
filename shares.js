const SHARES_CONF = "/etc/samba/shares.conf";
const SHARES_HEADER =
    "# Managed by the zfs-pools Cockpit plugin.\n" +
    "# Changes made here by hand may be overwritten.\n";

// Built-in sections that aren't real shares for our purposes
const HIDDEN_SECTIONS = ["global", "homes", "printers", "print$"];

function loadShares() {
    const container = document.getElementById("shares");

    const configCmd = cockpit.spawn(["testparm", "-s"]);
    // smbstatus needs root. If admin access is off, carry on without connection info
    const statusCmd = runAdmin(["smbstatus", "--json"]).catch(() => null);
    const managedCmd = readManagedShares().catch(() => ({}));

    Promise.all([configCmd, statusCmd, managedCmd])
        .then(([configText, statusText, managed]) => {
            const sections = parseSmbConfig(configText);
            const status = statusText ? JSON.parse(statusText) : null;

            container.textContent = "";
            const names = Object.keys(sections)
                .filter((name) => !HIDDEN_SECTIONS.includes(name.toLowerCase()))
                .sort();

            if (names.length === 0) {
                container.textContent = "No shares configured.";
                return;
            }

            for (const name of names) {
                container.appendChild(makeShareSection(name, sections[name], status, name in managed));
            }

            if (!status) {
                showMessage("Turn on Administrative access to see who is connected.", false);
            }
        })
        .catch((error) => {
            container.textContent = "Error loading shares: " + error.message;
        });
}
document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("new-share").addEventListener("click", openNewShareDialog);
    loadShares();
    setInterval(loadShares, 30000);
});

// Turns "[name]" / "key = value" text into { name: { key: value, ... }, ... }
function parseSmbConfig(text) {
    const sections = {};
    let current = null;

    for (const rawLine of text.split("\n")) {
        const line = rawLine.trim();
        if (line === "" || line.startsWith("#") || line.startsWith(";")) {
            continue;
        }

        const header = line.match(/^\[(.+)\]$/);
        if (header) {
            current = header[1];
            sections[current] = {};
            continue;
        }

        const eq = line.indexOf("=");
        if (current && eq !== -1) {
            const key = line.slice(0, eq).trim().toLowerCase();
            const value = line.slice(eq + 1).trim();
            sections[current][key] = value;
        }
    }
    return sections;
}

// Samba's default is "read only = yes", so a share is only writable if it says so
function isWritable(settings) {
    const ro = (settings["read only"] || "").toLowerCase();
    const w = (settings["writable"] || settings["writeable"] || "").toLowerCase();
    return ro === "no" || w === "yes";
}

function makeShareSection(name, settings, status, isManaged) {
    const section = document.createElement("div");
    section.className = "card";

    const title = document.createElement("h2");
    title.textContent = name;
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = isManaged ? "managed here" : "from smb.conf (edit by hand)";
    title.appendChild(tag);
    section.appendChild(title);

    if (isManaged) {
        const removeBtn = document.createElement("button");
        removeBtn.textContent = "Remove share";
        removeBtn.className = "danger";
        removeBtn.addEventListener("click", () => deleteShare(name));
        section.appendChild(removeBtn);
}

    const details = document.createElement("table");
    details.className = "data-table";
    const rows = [
        ["Path", settings["path"] || "(none)"],
        ["Access", isWritable(settings) ? "Read & write" : "Read only"],
        ["Allowed users", settings["valid users"] || "Anyone with a Samba account"],
        ["Windows address", "\\\\" + location.hostname + "\\" + name],
        ["Linux / Mac address", "smb://" + location.hostname + "/" + name],
    ];
    for (const [label, value] of rows) {
        const row = details.insertRow();
        const th = document.createElement("th");
        th.textContent = label;
        row.appendChild(th);
        row.insertCell().textContent = value;
    }
    section.appendChild(details);

    section.appendChild(makeConnectionsTable(name, status));
    return section;
}
// Who has this share open right now
function makeConnectionsTable(shareName, status) {
    const wrap = document.createElement("div");

    const heading = document.createElement("h3");
    heading.textContent = "Connected now";
    wrap.appendChild(heading);

    if (!status) {
        const p = document.createElement("p");
        p.textContent = "Unknown (needs Administrative access).";
        wrap.appendChild(p);
        return wrap;
    }

    const tcons = Object.values(status.tcons || {})
        .filter((t) => (t.service || "").toLowerCase() === shareName.toLowerCase());

    if (tcons.length === 0) {
        const p = document.createElement("p");
        p.textContent = "Nobody.";
        wrap.appendChild(p);
        return wrap;
    }

    const table = document.createElement("table");
    table.className = "data-table";
    const head = table.createTHead().insertRow();
    for (const label of ["User", "From", "Connected at"]) {
        const th = document.createElement("th");
        th.textContent = label;
        head.appendChild(th);
    }

    // Group connections by user + computer, since file managers open several at once
    const groups = {};
    for (const t of tcons) {
        const session = (status.sessions || {})[t.session_id] || {};
        const user = session.username || "?";
        const from = t.machine || session.remote_machine || "?";
        const key = user + "|" + from;

        if (!groups[key]) {
            groups[key] = { user: user, from: from, count: 0, since: null };
        }
        groups[key].count++;

        // Samba reports a wrong UTC offset (+17:00 instead of -07:00), but the clock
        // part is correct local time, so use only "YYYY-MM-DDTHH:MM:SS" (read as local time)
        const when = t.connected_at ? new Date(t.connected_at.slice(0, 19)) : null;
        if (when && (!groups[key].since || when < groups[key].since)) {
            groups[key].since = when;
        }
    }

    const body = table.createTBody();
    for (const g of Object.values(groups)) {
        const row = body.insertRow();
        row.insertCell().textContent = g.user;
        row.insertCell().textContent = g.from + (g.count > 1 ? " (" + g.count + " connections)" : "");
        row.insertCell().textContent = g.since ? g.since.toLocaleString() : "?";
    }
    wrap.appendChild(table);
    return wrap;
}
// ---------- Managed shares (shares.conf) ----------

// Reads /etc/samba/shares.conf into { name: { key: value } }. A missing file counts as empty.
async function readManagedShares() {
    const file = cockpit.file(SHARES_CONF);
    try {
        const text = await file.read();
        return parseSmbConfig(text || "");
    } finally {
        file.close();
    }
}

// Turns { name: { key: value } } back into config-file text
function serializeShares(sections) {
    let out = SHARES_HEADER;
    for (const name of Object.keys(sections).sort()) {
        out += "\n[" + name + "]\n";
        for (const [key, value] of Object.entries(sections[name])) {
            out += "    " + key + " = " + value + "\n";
        }
    }
    return out;
}

// Write -> check with testparm -> undo if Samba rejects it -> reload Samba
async function saveManagedShares(sections) {
    const file = cockpit.file(SHARES_CONF, { superuser: "require" });
    try {
        const oldText = await file.read();
        await file.replace(serializeShares(sections));

        try {
            await cockpit.spawn(["testparm", "-s"], { err: "message" });
        } catch (error) {
            await file.replace(oldText || SHARES_HEADER);
            throw new Error("Samba rejected the new configuration, so the change was undone. " + error.message);
        }
    } finally {
        file.close();
    }
    await runAdmin(["smbcontrol", "smbd", "reload-config"]);
}

async function openNewShareDialog() {
    let datasets;
    try {
        const text = await cockpit.spawn(["zfs", "list", "-H", "-o", "name,mountpoint", "-t", "filesystem"]);
        datasets = text.trim().split("\n")
            .map((line) => line.split("\t"))
            .filter(([name, mountpoint]) => mountpoint && mountpoint.startsWith("/"))
            .map(([name, mountpoint]) => ({ name: name, mountpoint: mountpoint }));
    } catch (error) {
        showMessage("Could not list datasets: " + error.message, true);
        return;
    }

    const dialog = document.createElement("dialog");
    dialog.className = "confirm";
    // Fixed markup only: no data from the system is inserted here, so innerHTML is safe
    dialog.innerHTML = `
        <h2>New share</h2>
        <label class="field">Share name
            <input name="name" placeholder="e.g. Photos" maxlength="32">
        </label>
        <label class="field">Folder (ZFS dataset)
            <select name="path"></select>
        </label>
        <label class="field">Allowed users (separate with spaces)
            <input name="users" value="ben">
        </label>
        <label class="check"><input type="checkbox" name="writable" checked> Allow writing</label>
        <p class="message"></p>
        <div class="confirm-buttons">
            <button class="secondary" data-action="cancel">Cancel</button>
            <button data-action="create">Create share</button>
        </div>`;

    const select = dialog.querySelector("select[name=path]");
    for (const d of datasets) {
        const option = document.createElement("option");
        option.value = d.mountpoint;
        option.textContent = d.name + "  (" + d.mountpoint + ")";
        select.appendChild(option);
    }

    dialog.querySelector("[data-action=cancel]").addEventListener("click", () => dialog.close());
    dialog.querySelector("[data-action=create]").addEventListener("click", () => createShareFromForm(dialog));
    dialog.addEventListener("close", () => dialog.remove());

    document.body.appendChild(dialog);
    dialog.showModal();
    dialog.querySelector("input[name=name]").focus();
}

async function createShareFromForm(dialog) {
    const name = dialog.querySelector("[name=name]").value.trim();
    const path = dialog.querySelector("[name=path]").value;
    const users = dialog.querySelector("[name=users]").value.split(/[\s,]+/).filter((u) => u !== "");
    const writable = dialog.querySelector("[name=writable]").checked;
    const createBtn = dialog.querySelector("[data-action=create]");

    // --- Validate everything before touching the system ---
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/.test(name)) {
        showMessage("Share name: up to 32 letters, numbers, - or _, starting with a letter or number.", true);
        return;
    }
    if (HIDDEN_SECTIONS.includes(name.toLowerCase())) {
        showMessage("'" + name + "' is a name reserved by Samba.", true);
        return;
    }
    if (!path.startsWith("/")) {
        showMessage("Choose a folder.", true);
        return;
    }
    if (users.length === 0) {
        showMessage("Add at least one allowed user.", true);
        return;
    }
    for (const user of users) {
        if (!/^[a-z_][a-z0-9_-]*$/.test(user)) {
            showMessage("'" + user + "' is not a valid user name.", true);
            return;
        }
    }

    createBtn.disabled = true;
    try {
        // Share names must be unique across ALL of Samba's config, not just our file
        const existing = parseSmbConfig(await cockpit.spawn(["testparm", "-s"]));
        if (Object.keys(existing).some((n) => n.toLowerCase() === name.toLowerCase())) {
            throw new Error("A share called '" + name + "' already exists.");
        }

        // Each user needs a Samba password, or they could never log in
        for (const user of users) {
            try {
                await runAdmin(["pdbedit", "-L", "-u", user]);
            } catch (error) {
                throw new Error("'" + user + "' has no Samba account. Run: sudo smbpasswd -a " + user);
            }
        }

        const managed = await readManagedShares();
        managed[name] = {
            "path": path,
            "read only": writable ? "no" : "yes",
            "valid users": users.join(" "),
        };
        await saveManagedShares(managed);

        dialog.close();
        showMessage("Created share " + name + ".");
        loadShares();
    } catch (error) {
        showMessage(error.message, true);
        createBtn.disabled = false;
    }
}

async function deleteShare(name) {
    const ok = await confirmDialog(
        "Remove the share\n\n" + name +
        "\n\nThe files in the folder are NOT deleted. Only network access to them is removed.",
        "Remove share", true
    );
    if (!ok) {
        return;
    }

    try {
        const managed = await readManagedShares();
        delete managed[name];
        await saveManagedShares(managed);
        showMessage("Removed share " + name + ".");
        loadShares();
    } catch (error) {
        showMessage("Could not remove share: " + error.message, true);
    }
}
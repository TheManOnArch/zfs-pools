// Built-in sections that aren't real shares for our purposes
const HIDDEN_SECTIONS = ["global", "homes", "printers", "print$"];

function loadShares() {
    const container = document.getElementById("shares");

    const configCmd = cockpit.spawn(["testparm", "-s"]);
    // smbstatus needs root. If admin access is off, carry on without connection info
    const statusCmd = runAdmin(["smbstatus", "--json"]).catch(() => null);

    Promise.all([configCmd, statusCmd])
        .then(([configText, statusText]) => {
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
                container.appendChild(makeShareSection(name, sections[name], status));
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

function makeShareSection(name, settings, status) {
    const section = document.createElement("div");
    section.className = "snap-section";

    const title = document.createElement("h2");
    title.textContent = name;
    section.appendChild(title);

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
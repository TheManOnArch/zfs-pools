// Fetches all snapshots, groups them by dataset, newest first
function loadSnapshots() {
    const container = document.getElementById("snapshots");

    cockpit.spawn(["zfs", "list", "-t", "snapshot", "-H", "-p", "-o", "name,creation,used,refer"])
        .then((text) => {
            container.textContent = "";

            const lines = text.trim().split("\n").filter((line) => line !== "");
            if (lines.length === 0) {
                container.textContent = "No snapshots yet.";
                return;
            }

            // Group snapshots by dataset: { "testPool/media": [ ... ], ... }
            const groups = {};
            for (const line of lines) {
                const [fullName, creation, used, refer] = line.split("\t");
                const [dataset, snapName] = fullName.split("@");

                if (!groups[dataset]) {
                    groups[dataset] = [];
                }
                groups[dataset].push({
                    name: snapName,
                    created: Number(creation),
                    used: Number(used),
                    refer: Number(refer),
                });
            }

            // One section per dataset, alphabetical; snapshots newest first
            for (const dataset of Object.keys(groups).sort()) {
                const snaps = groups[dataset].sort((a, b) => b.created - a.created);
                container.appendChild(makeDatasetSection(dataset, snaps));
            }
        })
        .catch((error) => {
            container.textContent = "Error loading snapshots: " + error.message;
        });
}

document.addEventListener("DOMContentLoaded", () => {
    loadSnapshots();
    setInterval(loadSnapshots, 60000);

    // Runs whenever the dialog closes, whether by the Close button or the Esc key
    const dialog = document.getElementById("browser");
    dialog.addEventListener("close", () => {
        browserState = null;
        dialog.textContent = "";
    });

    // Clicking the dimmed area outside the box also closes it
    dialog.addEventListener("click", (event) => {
        if (event.target === dialog) {
            dialog.close();
        }
    });
});

// A heading plus a table of that dataset's snapshots
function makeDatasetSection(dataset, snaps) {
    const section = document.createElement("div");
    section.className = "snap-section";

    const title = document.createElement("h2");
    title.textContent = dataset + " (" + snaps.length + ")";
    section.appendChild(title);
    const takeBtn = document.createElement("button");
    takeBtn.textContent = "Take snapshot now";
    takeBtn.addEventListener("click", () => takeSnapshot(dataset, takeBtn));
    section.appendChild(takeBtn);

    const table = document.createElement("table");
    table.className = "data-table";

    const head = table.createTHead().insertRow();
    for (const label of ["Snapshot", "Type", "Created", "Used", "Refer", ""]) {
        const th = document.createElement("th");
        th.textContent = label;
        head.appendChild(th);
    }

    const body = table.createTBody();
    for (const snap of snaps) {
        const row = body.insertRow();
        row.insertCell().textContent = snap.name;
        row.insertCell().textContent = snapType(snap.name);
        row.insertCell().textContent = new Date(snap.created * 1000).toLocaleString();

        const usedCell = row.insertCell();
        usedCell.textContent = formatBytes(snap.used);
        usedCell.className = "num";

        const referCell = row.insertCell();
        referCell.textContent = formatBytes(snap.refer);
        referCell.className = "num";
                const fullName = dataset + "@" + snap.name;
        const actions = row.insertCell();

        const browseBtn = document.createElement("button");
        browseBtn.textContent = "Browse";
        browseBtn.addEventListener("click", () => openBrowser(dataset, snap.name));
        actions.appendChild(browseBtn);

        const delBtn = document.createElement("button");
        delBtn.textContent = "Delete";
        delBtn.className = "danger";
        delBtn.addEventListener("click", () => deleteSnapshot(fullName, delBtn));
        actions.appendChild(delBtn);
    }

    section.appendChild(table);
    return section;
}

// "autosnap_..._hourly" -> "hourly"; anything else -> "manual"
function snapType(name) {
    const match = name.match(/_(frequently|hourly|daily|weekly|monthly|yearly)$/);
    return match ? match[1] : "manual";
}
// Takes a manual snapshot named like "manual-2026-10-24_18-30-05"
function takeSnapshot(dataset, button) {
    const snapName = "manual-" + timestampForName(new Date());
    button.disabled = true;

    runAdmin(["zfs", "snapshot", dataset + "@" + snapName])
        .then(() => {
            showMessage("Created " + dataset + "@" + snapName + ".");
            loadSnapshots();
        })
        .catch((error) => {
            showMessage("Could not create snapshot: " + error.message, true);
            button.disabled = false;
        });
}

// Deletes ONE snapshot, after asking first
function deleteSnapshot(fullName, button) {
    // Safety guard: without an "@", zfs destroy would delete a whole dataset
    if (!fullName.includes("@")) {
        showMessage("Refusing to delete '" + fullName + "': not a snapshot.", true);
        return;
    }

    const ok = window.confirm("Delete snapshot\n\n" + fullName + "\n\nThis cannot be undone.");
    if (!ok) {
        return;
    }

    button.disabled = true;
    runAdmin(["zfs", "destroy", fullName])
        .then(() => {
            showMessage("Deleted " + fullName + ".");
            loadSnapshots();
        })
        .catch((error) => {
            showMessage("Could not delete: " + error.message, true);
            button.disabled = false;
        });
}

// 2026-10-24 18:30:05 -> "2026-10-24_18-30-05" (local time)
function timestampForName(date) {
    const pad = (n) => String(n).padStart(2, "0");
    return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate()) +
        "_" + pad(date.getHours()) + "-" + pad(date.getMinutes()) + "-" + pad(date.getSeconds());
}
// ---------- Snapshot browser & restore ----------

// Remembers which snapshot is open: dataset, snapshot name, and the two root folders
let browserState = null;

function openBrowser(dataset, snapName) {
    runAdmin(["zfs", "get", "-H", "-o", "value", "mountpoint", dataset])
        .then((output) => {
            const mountpoint = output.trim();
            if (!mountpoint.startsWith("/")) {
                showMessage(dataset + " is not mounted (mountpoint: " + mountpoint + ").", true);
                return;
            }
            browserState = {
                dataset: dataset,
                snapName: snapName,
                liveRoot: mountpoint,
                snapRoot: mountpoint + "/.zfs/snapshot/" + snapName,
            };
            showDirectory("");
        })
        .catch((error) => showMessage("Could not open snapshot: " + error.message, true));
}

function closeBrowser() {
    document.getElementById("browser").close();
}

// "Movies" + "Film (2010)" -> "Movies/Film (2010)";  "" + "Movies" -> "Movies"
function joinPath(base, name) {
    return base ? base + "/" + name : name;
}

// Lists one folder inside the snapshot. relPath is relative to the snapshot root ("" = top).
function showDirectory(relPath) {
    const dir = relPath ? browserState.snapRoot + "/" + relPath : browserState.snapRoot;

    // %y = type (d = directory, f = file), %s = size in bytes, %f = name
    runAdmin(["find", dir, "-mindepth", "1", "-maxdepth", "1", "-printf", "%y\t%s\t%f\n"])
        .then((text) => {
            const items = text.split("\n")
                .filter((line) => line !== "")
                .map((line) => {
                    const [type, size, ...rest] = line.split("\t");
                    return { type: type, size: Number(size), name: rest.join("\t") };
                })
                // Folders first, then alphabetical
                .sort((a, b) => {
                    if ((a.type === "d") !== (b.type === "d")) {
                        return a.type === "d" ? -1 : 1;
                    }
                    return a.name.localeCompare(b.name);
                });
            renderBrowser(relPath, items);
        })
        .catch((error) => showMessage("Could not list folder: " + error.message, true));
}

function renderBrowser(relPath, items) {
    const box = document.getElementById("browser");
    box.textContent = "";
        if (!box.open) {
        box.showModal();
    }

    const title = document.createElement("h2");
    title.textContent = "Browsing " + browserState.dataset + "@" + browserState.snapName;
    box.appendChild(title);

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "Close";
    closeBtn.addEventListener("click", closeBrowser);
    box.appendChild(closeBtn);

    if (relPath) {
        const upBtn = document.createElement("button");
        upBtn.textContent = "Up one folder";
        upBtn.addEventListener("click", () => {
            const parts = relPath.split("/");
            parts.pop();
            showDirectory(parts.join("/"));
        });
        box.appendChild(upBtn);
    }

    const where = document.createElement("p");
    where.className = "path";
    where.textContent = "/" + relPath;
    box.appendChild(where);
    const dialogMessage = document.createElement("p");
    dialogMessage.id = "browser-message";
    dialogMessage.className = "message";
    box.appendChild(dialogMessage);

    if (items.length === 0) {
        const empty = document.createElement("p");
        empty.textContent = "This folder is empty.";
        box.appendChild(empty);
        return;
    }

    const table = document.createElement("table");
    table.className = "data-table";
    const head = table.createTHead().insertRow();
    for (const label of ["Name", "Size", ""]) {
        const th = document.createElement("th");
        th.textContent = label;
        head.appendChild(th);
    }

    const body = table.createTBody();
    for (const item of items) {
        const row = body.insertRow();
        const itemPath = joinPath(relPath, item.name);

        const nameCell = row.insertCell();
        if (item.type === "d") {
            const link = document.createElement("button");
            link.className = "link";
            link.textContent = item.name + "/";
            link.addEventListener("click", () => showDirectory(itemPath));
            nameCell.appendChild(link);
        } else {
            nameCell.textContent = item.name;
        }

        const sizeCell = row.insertCell();
        sizeCell.className = "num";
        sizeCell.textContent = item.type === "d" ? "" : formatBytes(item.size);

        const restoreBtn = document.createElement("button");
        restoreBtn.textContent = "Restore";
        restoreBtn.addEventListener("click", () => restoreItem(itemPath, item.type === "d", restoreBtn));
        row.insertCell().appendChild(restoreBtn);
    }
    box.appendChild(table);
}

// Copies one file or folder from the snapshot back to the same place in the live dataset
function restoreItem(relPath, isDir, button) {
    // Safety guard: never let a path climb out of the snapshot with ".."
    if (relPath.split("/").includes("..")) {
        showMessage("Refusing to restore a path containing '..'.", true);
        return;
    }

    const source = browserState.snapRoot + "/" + relPath;
    const target = browserState.liveRoot + "/" + relPath;

    // Does the item still exist in the live dataset? (test -e succeeds if it does)
    runAdmin(["test", "-e", target])
        .then(() => true)
        .catch(() => false)
        .then((exists) => {
            const question = exists
                ? "Restore and OVERWRITE the current version of\n\n" + target +
                  "\n\nwith the copy from " + browserState.snapName + "?\n\nAny changes made since then will be lost."
                : "Restore\n\n" + target + "\n\nfrom " + browserState.snapName + "?";
            if (!window.confirm(question)) {
                return;
            }

            button.disabled = true;
            // For folders, copy the CONTENTS ("source/.") so it never nests inside an existing folder
            const command = isDir
                ? ["cp", "-a", "--", source + "/.", target]
                : ["cp", "-a", "--", source, target];

            return runAdmin(command)
                .then(() => showMessage("Restored " + target + "."))
                .catch((error) => {
                    showMessage("Restore failed: " + error.message, true);
                    button.disabled = false;
                });
        });
}
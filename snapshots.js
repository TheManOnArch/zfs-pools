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
});

// A heading plus a table of that dataset's snapshots
function makeDatasetSection(dataset, snaps) {
    const section = document.createElement("div");
    section.className = "snap-section";

    const title = document.createElement("h2");
    title.textContent = dataset + " (" + snaps.length + ")";
    section.appendChild(title);

    const table = document.createElement("table");
    table.className = "data-table";

    const head = table.createTHead().insertRow();
    for (const label of ["Snapshot", "Type", "Created", "Used", "Refer"]) {
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
    }

    section.appendChild(table);
    return section;
}

// "autosnap_..._hourly" -> "hourly"; anything else -> "manual"
function snapType(name) {
    const match = name.match(/_(frequently|hourly|daily|weekly|monthly|yearly)$/);
    return match ? match[1] : "manual";
}
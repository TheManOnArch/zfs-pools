const SVG_NS = "http://www.w3.org/2000/svg";

// Fetches pool data and rebuilds the cards
function loadPools() {
    const container = document.getElementById("pools");

    const listCmd = cockpit.spawn(["zpool", "list", "-H", "-p", "-o", "name,size,alloc,free,health"]);
    const statusCmd = cockpit.spawn(["zpool", "status", "-j"]);

    Promise.all([listCmd, statusCmd])
        .then(([listText, statusText]) => {
            const status = JSON.parse(statusText);
            container.textContent = "";

            const lines = listText.trim().split("\n");
            for (const line of lines) {
                const [name, size, alloc, free, health] = line.split("\t");
                const percent = (Number(alloc) / Number(size)) * 100;

                const pool = status.pools[name];
                const disks = [];
                for (const vdev of Object.values(pool.vdevs)) {
                    collectDisks(vdev, disks);
                }

                container.appendChild(
                    makePoolCard(name, percent, health, Number(size), Number(alloc), disks, pool.scan_stats)
                );
            }
        })
        .catch((error) => {
            container.textContent = "Error loading pools: " + error.message;
        });
}

document.addEventListener("DOMContentLoaded", () => {
    loadPools();
    setInterval(loadPools, 30000);
});

// Walks down the vdev tree and collects every disk into one list
function collectDisks(vdev, disks) {
    if (vdev.vdev_type === "disk") {
        disks.push(vdev);
        return;
    }
    for (const child of Object.values(vdev.vdevs || {})) {
        collectDisks(child, disks);
    }
}

// Builds one card: name, donut, health, usage, scrub, disks
function makePoolCard(name, percent, health, size, alloc, disks, scan) {
    const card = document.createElement("div");
    card.className = "pool-card";

    const title = document.createElement("h2");
    title.textContent = name;
    card.appendChild(title);

    card.appendChild(makeDonut(percent));

    const status = document.createElement("p");
    status.className = "health " + healthClass(health);
    status.textContent = health;
    card.appendChild(status);

    const usage = document.createElement("p");
    usage.textContent = formatBytes(alloc) + " used of " + formatBytes(size);
    card.appendChild(usage);

    const scrub = document.createElement("p");
    scrub.className = "scrub";
    scrub.textContent = scrubText(scan);
    card.appendChild(scrub);

    card.appendChild(makeDiskTable(disks));

    return card;
}

// One row per disk: name, state, read/write/checksum errors
function makeDiskTable(disks) {
    const table = document.createElement("table");
    table.className = "disks";

    const head = table.createTHead().insertRow();
    for (const label of ["Disk", "State", "Read", "Write", "Cksum"]) {
        const th = document.createElement("th");
        th.textContent = label;
        head.appendChild(th);
    }

    const body = table.createTBody();
    for (const disk of disks) {
        const row = body.insertRow();

        row.insertCell().textContent = disk.name;

        const stateCell = row.insertCell();
        stateCell.textContent = disk.state;
        stateCell.className = "health " + healthClass(disk.state);

        for (const key of ["read_errors", "write_errors", "checksum_errors"]) {
            const cell = row.insertCell();
            const count = Number(disk[key]);
            cell.textContent = count;
            cell.className = "num" + (count > 0 ? " bad-count" : "");
        }
    }

    return table;
}

// "Last scrub: Sat Oct 24 ..., 0 errors"
function scrubText(scan) {
    if (!scan || scan.function !== "SCRUB") {
        return "No scrub has run yet";
    }
    if (scan.state !== "FINISHED") {
        return "Scrub " + scan.state.toLowerCase() + "...";
    }
    return "Last scrub: " + scan.end_time + ", " + scan.errors + " errors";
}
// Draws the donut chart with SVG
function makeDonut(percent) {
    const radius = 40;
    const circumference = 2 * Math.PI * radius;
    const used = (percent / 100) * circumference;

    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 100 100");
    svg.setAttribute("class", "donut");

    const track = document.createElementNS(SVG_NS, "circle");
    track.setAttribute("cx", "50");
    track.setAttribute("cy", "50");
    track.setAttribute("r", radius);
    track.setAttribute("class", "donut-track");
    svg.appendChild(track);

    const fill = document.createElementNS(SVG_NS, "circle");
    fill.setAttribute("cx", "50");
    fill.setAttribute("cy", "50");
    fill.setAttribute("r", radius);
    fill.setAttribute("class", "donut-fill");
    fill.setAttribute("stroke-dasharray", used + " " + circumference);
    fill.setAttribute("transform", "rotate(-90 50 50)");
    svg.appendChild(fill);

    const label = document.createElementNS(SVG_NS, "text");
    label.setAttribute("x", "50");
    label.setAttribute("y", "50");
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("dominant-baseline", "middle");
    label.setAttribute("class", "donut-label");
    label.textContent = percent.toFixed(1) + "%";
    svg.appendChild(label);

    return svg;
}

function healthClass(health) {
    if (health === "ONLINE") return "ok";
    if (health === "DEGRADED") return "warn";
    return "bad";
}

// 2093056 -> "2.0 MB"
function formatBytes(bytes) {
    const units = ["B", "KB", "MB", "GB", "TB"];
    let i = 0;
    while (bytes >= 1024 && i < units.length - 1) {
        bytes /= 1024;
        i++;
    }
    return bytes.toFixed(1) + " " + units[i];
}
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
    const scrubRunning = scan && scan.function === "SCRUB" && scan.state === "SCANNING";
    const scrubBtn = document.createElement("button");
    scrubBtn.textContent = scrubRunning ? "Scrub running..." : "Start scrub";
    scrubBtn.disabled = scrubRunning;
    scrubBtn.addEventListener("click", () => {
        scrubBtn.disabled = true;
        runAdmin(["zpool", "scrub", name])
            .then(() => {
                showMessage("Scrub started on " + name + ".");
                loadPools();
            })
            .catch((error) => {
                showMessage("Could not start scrub: " + error.message, true);
                scrubBtn.disabled = false;
            });
    });
    card.appendChild(scrubBtn);
    const datasetBtn = document.createElement("button");
    datasetBtn.textContent = "New dataset";
    datasetBtn.addEventListener("click", () => openNewDatasetDialog(name));
    card.appendChild(datasetBtn);
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
// ---------- New dataset ----------

// Normal login users (UID 1000 and up), read from the system's user list
async function listUsers() {
    const text = await cockpit.spawn(["getent", "passwd"]);
    return text.trim().split("\n")
        .map((line) => line.split(":"))
        .filter((f) => Number(f[2]) >= 1000 && Number(f[2]) < 65534)
        .map((f) => ({ name: f[0], gid: f[3] }));
}

async function openNewDatasetDialog(pool) {
    let users;
    try {
        users = await listUsers();
    } catch (error) {
        showMessage("Could not list users: " + error.message, true);
        return;
    }

    const dialog = document.createElement("dialog");
    dialog.className = "confirm";
    // Fixed markup only; real data is added below with textContent
    dialog.innerHTML = `
        <h2></h2>
        <label class="field">Name
            <input name="name" placeholder="e.g. photos" maxlength="64">
        </label>
        <label class="field">Owner
            <select name="owner"></select>
        </label>
        <label class="field">Size limit (optional, e.g. 500G or 2T)
            <input name="quota" placeholder="no limit">
        </label>
        <p class="message"></p>
        <div class="confirm-buttons">
            <button class="secondary" data-action="cancel">Cancel</button>
            <button data-action="create">Create dataset</button>
        </div>`;
    dialog.querySelector("h2").textContent = "New dataset in " + pool;

    const select = dialog.querySelector("select[name=owner]");
    for (const user of users) {
        const option = document.createElement("option");
        option.value = user.name + ":" + user.gid;
        option.textContent = user.name;
        select.appendChild(option);
    }

    dialog.querySelector("[data-action=cancel]").addEventListener("click", () => dialog.close());
    dialog.querySelector("[data-action=create]").addEventListener("click", () => createDataset(pool, dialog));
    dialog.addEventListener("close", () => dialog.remove());

    document.body.appendChild(dialog);
    dialog.showModal();
    dialog.querySelector("input[name=name]").focus();
}

async function createDataset(pool, dialog) {
    const name = dialog.querySelector("[name=name]").value.trim();
    const owner = dialog.querySelector("[name=owner]").value;
    const quota = dialog.querySelector("[name=quota]").value.trim().toUpperCase();
    const button = dialog.querySelector("[data-action=create]");

    // --- Validate before touching the system ---
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(name)) {
        showMessage("Name: letters, numbers, - or _, starting with a letter or number.", true);
        return;
    }
    if (!owner) {
        showMessage("Choose an owner. Create a user in Accounts first if the list is empty.", true);
        return;
    }
    if (quota !== "" && !/^[1-9][0-9]*[KMGT]$/.test(quota)) {
        showMessage("Size limit: a number followed by K, M, G or T (e.g. 500G), or leave it empty.", true);
        return;
    }

    const dataset = pool + "/" + name;
    const command = ["zfs", "create"];
    if (quota !== "") {
        command.push("-o", "quota=" + quota);
    }
    command.push(dataset);

    button.disabled = true;
    try {
        await runAdmin(command);

        // Find where it was mounted, then give it to the chosen owner
        const mountpoint = (await runAdmin(["zfs", "get", "-H", "-o", "value", "mountpoint", dataset])).trim();
        if (!mountpoint.startsWith("/")) {
            throw new Error("Created " + dataset + ", but it has no mountpoint (" + mountpoint + ").");
        }
        await runAdmin(["chown", owner, mountpoint]);

        dialog.close();
        showMessage("Created " + dataset + " at " + mountpoint + ".");
        loadPools();
    } catch (error) {
        showMessage("Could not create dataset: " + error.message, true);
        button.disabled = false;
    }
}
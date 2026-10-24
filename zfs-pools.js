const SVG_NS = "http://www.w3.org/2000/svg";

function loadPools() {
    const container = document.getElementById("pools");

    cockpit.spawn(["zpool", "list", "-H", "-p", "-o", "name,size,alloc,free,health"])
        .then((data) => {
            container.textContent = "";
            const lines = data.trim().split("\n");
            for (const line of lines) {
                const [name, size, alloc, free, health] = line.split("\t");
                const percent = (Number(alloc) / Number(size)) * 100;
                container.appendChild(
                    makePoolCard(name, percent, health, Number(size), Number(alloc))
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

// Builds one card: name, donut, health, usage text
function makePoolCard(name, percent, health, size, alloc) {
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

    return card;
}

// Draws the donut chart with SVG
function makeDonut(percent) {
    const radius = 40;
    const circumference = 2 * Math.PI * radius;
    const used = (percent / 100) * circumference;

    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 100 100");
    svg.setAttribute("class", "donut");

    // grey background ring = whole pool
    const track = document.createElementNS(SVG_NS, "circle");
    track.setAttribute("cx", "50");
    track.setAttribute("cy", "50");
    track.setAttribute("r", radius);
    track.setAttribute("class", "donut-track");
    svg.appendChild(track);

    // colored ring = used space
    const fill = document.createElementNS(SVG_NS, "circle");
    fill.setAttribute("cx", "50");
    fill.setAttribute("cy", "50");
    fill.setAttribute("r", radius);
    fill.setAttribute("class", "donut-fill");
    fill.setAttribute("stroke-dasharray", used + " " + circumference);
    fill.setAttribute("transform", "rotate(-90 50 50)");  // start at the top
    svg.appendChild(fill);

    // percentage in the middle
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

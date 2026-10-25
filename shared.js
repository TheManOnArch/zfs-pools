// Shared helpers used by every page in the plugin

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
// Runs a command as root (needs "Administrative access" turned on in Cockpit)
function runAdmin(command) {
    return cockpit.spawn(command, { superuser: "require", err: "message" });
}

// Shows a status line at the top of the page (green for success, red for errors)
function showMessage(text, isError) {
    const box = document.getElementById("message");
    box.textContent = text;
    box.className = isError ? "message error" : "message ok";
}
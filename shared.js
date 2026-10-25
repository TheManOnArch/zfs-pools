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

// Shows a status line (green for success, red for errors).
// If a dialog with its own message line is open, the message goes there instead.
function showMessage(text, isError) {
    const dialog = document.querySelector("dialog[open]");
    const dialogBox = dialog ? dialog.querySelector(".message") : null;
    const box = dialogBox || document.getElementById("message");

    box.textContent = text;
    box.className = isError ? "message error" : "message ok";
}

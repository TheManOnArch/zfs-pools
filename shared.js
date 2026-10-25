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

let messageTimer = null;

// Shows a status line. Success messages fade after 5 seconds; errors stay until replaced.
function showMessage(text, isError) {
    const dialog = document.querySelector("dialog[open]");
    const dialogBox = dialog ? dialog.querySelector(".message") : null;
    const box = dialogBox || document.getElementById("message");

    clearTimeout(messageTimer);
    box.textContent = text;
    box.className = isError ? "message error" : "message ok";

    if (!isError) {
        messageTimer = setTimeout(() => box.classList.add("fade"), 5000);
    }
}
// A styled yes/no pop-up. Returns a Promise that resolves to true (confirmed) or false.
function confirmDialog(message, confirmText, danger) {
    return new Promise((resolve) => {
        const dialog = document.createElement("dialog");
        dialog.className = "confirm";

        const text = document.createElement("p");
        text.textContent = message;
        dialog.appendChild(text);

        const buttons = document.createElement("div");
        buttons.className = "confirm-buttons";

        const cancelBtn = document.createElement("button");
        cancelBtn.textContent = "Cancel";
        cancelBtn.className = "secondary";

        const okBtn = document.createElement("button");
        okBtn.textContent = confirmText || "OK";
        if (danger) {
            okBtn.className = "danger-solid";
        }

        buttons.appendChild(cancelBtn);
        buttons.appendChild(okBtn);
        dialog.appendChild(buttons);

        // Whatever closes the dialog (a button, or Esc) ends up here exactly once
        let answer = false;
        cancelBtn.addEventListener("click", () => dialog.close());
        okBtn.addEventListener("click", () => {
            answer = true;
            dialog.close();
        });
        dialog.addEventListener("close", () => {
            dialog.remove();
            resolve(answer);
        });

        document.body.appendChild(dialog);
        dialog.showModal();
        cancelBtn.focus();   // the safe choice has focus, so pressing Enter cancels
    });
}
const TOPIC_FILE = "/etc/nas-os/ntfy-topic";
const TOPIC_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

document.addEventListener("DOMContentLoaded", async () => {
    const input = document.getElementById("topic");

    // Show the current topic, if one is saved
    const file = cockpit.file(TOPIC_FILE, { superuser: "try" });
    try {
        input.value = ((await file.read()) || "").trim();
    } catch (error) {
        showMessage("Could not read the current topic: " + error.message, true);
    } finally {
        file.close();
    }

    document.getElementById("generate").addEventListener("click", () => {
        input.value = "nas-" + crypto.randomUUID();
    });
    document.getElementById("save").addEventListener("click", () => saveTopic(input.value.trim()));
    document.getElementById("test").addEventListener("click", () => sendTest(input.value.trim()));
});

async function saveTopic(topic) {
    if (topic !== "" && !TOPIC_PATTERN.test(topic)) {
        showMessage("Topic: up to 64 letters, numbers, - or _.", true);
        return;
    }

    const file = cockpit.file(TOPIC_FILE, { superuser: "require" });
    try {
        await file.replace(topic === "" ? "" : topic + "\n");
        // ZED reads its config at startup, so restart it to pick up the new topic
        await runAdmin(["systemctl", "restart", "zfs-zed"]);
        showMessage(topic === "" ? "Notifications turned off." : "Saved. Alerts will go to " + topic + ".");
    } catch (error) {
        showMessage("Could not save: " + error.message, true);
    } finally {
        file.close();
    }
}

async function sendTest(topic) {
    if (!TOPIC_PATTERN.test(topic)) {
        showMessage("Enter or generate a valid topic first.", true);
        return;
    }
    try {
        await runAdmin(["curl", "-sf",
            "-H", "Title: Test from your NAS",
            "-d", "If you can read this, notifications work.",
            "https://ntfy.sh/" + topic]);
        showMessage("Test sent. Check your phone.");
    } catch (error) {
        showMessage("Could not send: " + error.message, true);
    }
}
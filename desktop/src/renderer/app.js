const api = window.productivityDesktop;
const $ = (selector) => document.querySelector(selector);
let reminders = [];
let messageTimer;

function showMessage(message, isError = false) {
  const element = $("#message");
  element.textContent = message;
  element.classList.toggle("error", isError);
  element.classList.remove("hidden");
  clearTimeout(messageTimer);
  messageTimer = setTimeout(() => element.classList.add("hidden"), 5000);
}

function setPanelState(signedIn) {
  $("#login-panel").classList.toggle("hidden", signedIn);
  $("#account-panel").classList.toggle("hidden", !signedIn);
  $("#reminders-panel").classList.toggle("hidden", !signedIn);
  $("#sync-button").classList.toggle("hidden", !signedIn);
}

function formatSchedule(value) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function renderReminders() {
  const list = $("#reminder-list");
  list.replaceChildren();
  $("#empty-state").classList.toggle("hidden", reminders.length !== 0);

  for (const reminder of reminders) {
    const card = document.createElement("article");
    card.className = "reminder-card";
    const detail = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = reminder.task_id === null ? "Standalone reminder" : `Task ${reminder.task_id} reminder`;
    const time = document.createElement("p");
    time.className = "muted";
    time.textContent = formatSchedule(reminder.scheduled_at);
    const status = document.createElement("span");
    status.className = `status status-${reminder.status}`;
    status.textContent = reminder.status;
    detail.append(title, time, status);

    const mode = document.createElement("select");
    mode.setAttribute("aria-label", `Delivery mode for reminder ${reminder.id}`);
    for (const [value, label] of [["notification", "Notification"], ["sound", "Sound + window"]]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      option.selected = reminder.delivery_mode === value;
      mode.append(option);
    }
    mode.disabled = reminder.status !== "scheduled";
    mode.addEventListener("change", async () => {
      try {
        await api.setDeliveryMode(reminder.id, mode.value);
        reminder.delivery_mode = mode.value;
        showMessage("Delivery preference saved on this desktop.");
      } catch (error) {
        showMessage(error.message, true);
      }
    });
    card.append(detail, mode);
    list.append(card);
  }
}

async function sync() {
  try {
    reminders = await api.syncReminders();
    renderReminders();
  } catch (error) {
    showMessage(error.message, true);
  }
}

async function loadState() {
  try {
    const state = await api.getState();
    $("#api-origin").value = state.settings.apiOrigin;
    $("#ring-duration").value = String(state.settings.ringingDurationSeconds);
    $("#snooze-duration").value = String(state.settings.snoozeMinutes);
    $("#launch-startup").checked = state.settings.launchAtStartup;
    $("#sound-name").textContent = state.settings.soundFilePath?.split(/[\\/]/).at(-1) ?? "No sound selected";
    setPanelState(Boolean(state.user));
    if (state.user) {
      $("#account-name").textContent = state.user.first_name ? `Hello, ${state.user.first_name}` : "Your account";
      $("#account-email").textContent = state.user.email;
      await sync();
    }
  } catch (error) {
    showMessage(error.message, true);
  }
}

$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    await api.setApiOrigin($("#api-origin").value);
    const user = await api.login($("#email").value, $("#password").value);
    $("#password").value = "";
    $("#account-name").textContent = user.first_name ? `Hello, ${user.first_name}` : "Your account";
    $("#account-email").textContent = user.email;
    setPanelState(true);
    await sync();
    showMessage("Signed in. Reminder sync is running in the background.");
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    button.disabled = false;
  }
});

$("#sync-button").addEventListener("click", () => void sync());
$("#logout-button").addEventListener("click", async () => {
  try {
    await api.logout();
    reminders = [];
    renderReminders();
    setPanelState(false);
    showMessage("Signed out.");
  } catch (error) {
    showMessage(error.message, true);
  }
});

$("#sound-button").addEventListener("click", async () => {
  try {
    const filename = await api.chooseSoundFile();
    if (filename) $("#sound-name").textContent = filename;
  } catch (error) {
    showMessage(error.message, true);
  }
});

async function saveTimingSettings() {
  try {
    await api.updateSettings({
      ringingDurationSeconds: Number($("#ring-duration").value),
      snoozeMinutes: Number($("#snooze-duration").value),
    });
    showMessage("Sound timing settings saved.");
  } catch (error) {
    showMessage(error.message, true);
    await loadState();
  }
}

$("#ring-duration").addEventListener("change", () => void saveTimingSettings());
$("#snooze-duration").addEventListener("change", () => void saveTimingSettings());
$("#launch-startup").addEventListener("change", async (event) => {
  try {
    await api.setLaunchAtStartup(event.currentTarget.checked);
    showMessage("Windows startup preference saved.");
  } catch (error) {
    showMessage(error.message, true);
    event.currentTarget.checked = !event.currentTarget.checked;
  }
});

void loadState();
setInterval(() => { if (!$("#login-panel").classList.contains("hidden")) return; void sync(); }, 30_000);

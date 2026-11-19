const api = window.productivityDesktop;
const player = document.querySelector("#ringer");

async function initialize() {
  const active = await api.getActiveReminder();
  if (!active) {
    await api.openMainWindow();
    return;
  }
  document.querySelector("#reminder-title").textContent = active.taskId === null
    ? "Your reminder is due"
    : `Task ${active.taskId} reminder`;
  document.querySelector("#reminder-time").textContent = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(active.scheduledAt));

  try {
    const audioData = await api.getSoundData();
    if (audioData) {
      player.src = audioData;
      await player.play();
    } else {
      document.querySelector("#sound-warning").classList.remove("hidden");
    }
  } catch {
    document.querySelector("#sound-warning").classList.remove("hidden");
  }
}

document.querySelector("#dismiss-button").addEventListener("click", async () => {
  player.pause();
  await api.dismissReminder();
});
document.querySelector("#snooze-button").addEventListener("click", async () => {
  player.pause();
  await api.snoozeReminder();
});
void initialize();

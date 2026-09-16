const storageKey = "video-sync-interface-directions-v2";
const buttons = [...document.querySelectorAll("[data-direction]")];
const summary = document.querySelector("#selection-summary");
const count = document.querySelector("#selection-count");

let selected;
try {
  const stored = JSON.parse(localStorage.getItem(storageKey) || "[]");
  selected = Array.isArray(stored) ? stored.slice(-3) : [];
} catch {
  selected = [];
}

function render() {
  buttons.forEach((button) => {
    button.setAttribute("aria-pressed", String(selected.includes(button.dataset.direction)));
  });
  const names = selected.map((id) => buttons.find((button) => button.dataset.direction === id)?.dataset.name).filter(Boolean);
  summary.textContent = names.length ? names.join(" · ") : "None yet";
  count.textContent = `${names.length} / 3`;
  localStorage.setItem(storageKey, JSON.stringify(selected));
}

buttons.forEach((button) => {
  button.addEventListener("click", () => {
    const id = button.dataset.direction;
    if (selected.includes(id)) selected = selected.filter((item) => item !== id);
    else selected = [...selected.slice(-2), id];
    render();
  });
});

render();

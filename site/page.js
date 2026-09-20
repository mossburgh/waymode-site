for (const link of document.querySelectorAll(".force-node")) {
  link.addEventListener("click", () => {
    const answer = document.querySelector(link.getAttribute("href"));
    if (answer instanceof HTMLDetailsElement) {
      answer.open = true;
      requestAnimationFrame(() => {
        answer.querySelector("summary").focus({ preventScroll: true });
      });
    }
  });
}

const copyButton = document.querySelector("[data-copy-install]");
const copyLabel = copyButton.querySelector("[data-copy-label]");
let copyReset;
copyButton.addEventListener("click", async () => {
  const status = document.querySelector(".install-status");
  clearTimeout(copyReset);
  copyButton.classList.remove("is-copied");
  copyLabel.textContent = "Copy prompt";
  status.textContent = "";
  copyButton.disabled = true;
  try {
    await navigator.clipboard.writeText(
      document.querySelector(".install-prompt").textContent.trim(),
    );
    copyLabel.textContent = "Copied";
    copyButton.classList.add("is-copied");
    status.textContent = "Copied. Paste it into your coding agent.";
    copyReset = setTimeout(() => {
      copyButton.classList.remove("is-copied");
      copyLabel.textContent = "Copy prompt";
    }, 2500);
  } catch {
    document.querySelector("#install-prompt").open = true;
    status.textContent = "Copy the prompt shown above.";
  } finally {
    copyButton.disabled = false;
  }
});

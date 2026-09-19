export const mountFeature = (container: HTMLElement) => {
  const note = document.createElement("p");
  note.textContent = "Your account settings will appear here.";
  container.append(note);
};

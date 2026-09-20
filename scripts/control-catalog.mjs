import { readFile, writeFile } from "node:fs/promises";
import { Window } from "happy-dom";
import {
  computeAccessibleName,
  computeAccessibleDescription,
  getRole,
} from "dom-accessibility-api";

const controls = new Map();
for (const file of [
  "public/index.html",
  "demo/studio.html",
  "demo/product.html",
]) {
  const window = new Window({
    url: "https://waymode.ai",
    settings: {
      disableJavaScriptEvaluation: true,
      disableCSSFileLoading: true,
      disableJavaScriptFileLoading: true,
    },
  });
  window.document.body.innerHTML = await readFile(file, "utf8");
  for (const element of window.document.querySelectorAll(
    "a[href],button,summary,input,textarea,select",
  )) {
    if (element.matches("summary")) {
      element.setAttribute("role", "button");
    }
    const name = computeAccessibleName(element, { hidden: true });
    const role = getRole(element) ?? "button";
    if (!name) {
      continue;
    }
    const control = {
      name,
      role,
      description: computeAccessibleDescription(element),
      editable: element.matches(
        "textarea,input:not([type=checkbox]):not([type=radio]),select",
      ),
    };
    controls.set(`${role}:${name}`, control);
  }
  await window.happyDOM.close();
}
const source = JSON.stringify([...controls.values()], null, 2) + "\n";
await writeFile("hosted/site-controls.json", source);

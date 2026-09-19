import story from "./story.json" with { type: "json" };

export const prepareLaunch = async () => {
  if (!new URLSearchParams(location.search).has("launch")) {
    return;
  }
  const response = await fetch("/api/v1/daylist", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ preferences: story.handoff.preferences }),
  });
  if (!response.ok) {
    throw new Error("Could not prepare the interactive demo.");
  }
};

export const announceLaunch = () => {
  if (window.parent !== window) {
    window.parent.postMessage({ type: "waymode:ready" }, location.origin);
  }
};

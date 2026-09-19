import { createContext, useContext, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { useLiveView } from "@mossburgh/waymode/react";
import { createWaymode, createHttpDecider } from "@mossburgh/waymode";

type Message =
  | { type: "app-view"; id: string }
  | { type: "action-receipt"; id: string; text: string };
const AccountContext = createContext("");

const Account = ({
  embedded,
  onMove,
  featureAdded,
}: {
  embedded: boolean;
  onMove: () => void;
  featureAdded: boolean;
}) => {
  const [draft, setDraft] = useState("");
  const [enabled, setEnabled] = useState(false);
  const account = useContext(AccountContext);
  return (
    <section className="account">
      <h2>{account}</h2>
      <label>
        Display name
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Type an unsaved draft"
        />
      </label>
      <p>Your draft stays in the same component when it moves.</p>
      {featureAdded && (
        <button onClick={() => setEnabled(true)} disabled={enabled}>
          {enabled ? "Weekly digest enabled" : "Enable weekly digest"}
        </button>
      )}
      <button onClick={onMove}>
        {embedded ? "Return to workspace" : "Embed in chat"}
      </button>
    </section>
  );
};

const useRun = (
  root: ReturnType<typeof useLiveView>["root"],
  goal: string,
  append: (text: string) => void,
) => {
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const run = async () => {
    if (!goal.trim() || busy) {
      return;
    }
    setBusy(true);
    const abort = new AbortController();
    controller.current = abort;
    const agent = createWaymode({
      root,
      decide: createHttpDecider("/api/v1/decisions"),
    });
    try {
      const result = await agent.run(goal, {
        signal: abort.signal,
        onAction: (control) => append(`Invoked “${control.name}”.`),
      });
      append(
        `Run ended: ${result.reason}. ${result.actions} controls invoked.`,
      );
    } catch (error) {
      append(error instanceof Error ? error.message : "Request failed.");
    } finally {
      controller.current = null;
      setBusy(false);
    }
  };
  return { busy, run, stop: () => controller.current?.abort() };
};
type LiveView = ReturnType<typeof useLiveView>;
const Workspace = ({
  embedded,
  view,
  featureAdded,
  addFeature,
}: {
  embedded: boolean;
  view: LiveView;
  featureAdded: boolean;
  addFeature: () => void;
}) => (
  <section className="pane">
    <h2>Workspace</h2>
    {embedded ? <p>The account is in chat.</p> : <div ref={view.outletRef} />}
    <button onClick={addFeature} disabled={featureAdded}>
      Add a sample control
    </button>
  </section>
);
const ChatMessages = ({
  messages,
  embedded,
  view,
}: {
  messages: Message[];
  embedded: boolean;
  view: LiveView;
}) => (
  <>
    {messages.map((message) =>
      message.type === "app-view" ? (
        <div key={message.id}>{embedded && <div ref={view.outletRef} />}</div>
      ) : (
        <p key={message.id} role="status">
          {message.text}
        </p>
      ),
    )}
  </>
);
const Prompt = ({
  goal,
  setGoal,
  agent,
}: {
  goal: string;
  setGoal: (value: string) => void;
  agent: ReturnType<typeof useRun>;
}) => (
  <form
    onSubmit={(event) => {
      event.preventDefault();
      void agent.run();
    }}
  >
    <label>
      Ask Jev
      <input
        value={goal}
        onChange={(event) => setGoal(event.target.value)}
        placeholder="Embed the account in chat"
        required
      />
    </label>
    <button disabled={agent.busy}>Send</button>
    {agent.busy && (
      <button type="button" onClick={agent.stop}>
        Stop
      </button>
    )}
  </form>
);
const useChat = () => {
  const [messages, setMessages] = useState<Message[]>([
    { type: "app-view", id: "account" },
  ]);
  const append = (text: string) =>
    setMessages((items) => [
      ...items,
      { type: "action-receipt", id: crypto.randomUUID(), text },
    ]);
  return { messages, append };
};
const App = () => {
  const [embedded, setEmbedded] = useState(false);
  const [featureAdded, setFeatureAdded] = useState(false);
  const [goal, setGoal] = useState("");
  const { messages, append } = useChat();
  const view = useLiveView(
    <Account
      embedded={embedded}
      onMove={() => setEmbedded((value) => !value)}
      featureAdded={featureAdded}
    />,
  );
  const agent = useRun(view.root, goal, append);
  return (
    <AccountContext.Provider value="Your account">
      {view.content}
      <header>
        <h1>waymode / React</h1>
        <p>One live view. Two places to use it.</p>
      </header>
      <main>
        <Workspace
          embedded={embedded}
          view={view}
          featureAdded={featureAdded}
          addFeature={() => setFeatureAdded(true)}
        />
        <section className="pane">
          <h2>Chat</h2>
          <ChatMessages messages={messages} embedded={embedded} view={view} />
          <Prompt goal={goal} setGoal={setGoal} agent={agent} />
        </section>
      </main>
      <footer>
        Type a draft, move the view, then add a control and ask Jev to use it.
        The sample control toggles local state.
      </footer>
    </AccountContext.Provider>
  );
};

const style = document.createElement("style");
style.textContent = `:root{font:15px/1.5 system-ui;color:#192330;background:#f3f5f8}*{box-sizing:border-box}body{margin:0;padding:40px;max-width:1400px;margin-inline:auto}header{margin-bottom:28px}h1{font-size:28px;letter-spacing:-1px}h2{font-size:20px}main{display:grid;grid-template-columns:1fr 1fr;gap:24px}.pane{background:white;padding:28px;border:1px solid #d4dbe5;border-radius:8px;min-width:0}.account{padding:20px;border:1px solid #a6bce8;border-radius:6px;margin-bottom:20px}label{display:grid;gap:7px}input{font:inherit;padding:10px;width:100%;border:1px solid #b9c8dd;border-radius:4px}button{font:inherit;padding:8px 12px;border:1px solid #b9c8dd;background:white;border-radius:4px;cursor:pointer;margin:10px 8px 0 0}button:disabled{opacity:.5;cursor:default}p,footer{color:#647083}footer{margin-top:24px;font-size:13px}:focus-visible{outline:3px solid #2459d3;outline-offset:3px}form{margin-top:24px}@media(max-width:720px){body{padding:20px}main{grid-template-columns:1fr}}`;
document.head.append(style);
const root = document.getElementById("root");
if (!root) {
  throw new Error("Missing React host root.");
}
createRoot(root).render(<App />);

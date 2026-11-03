import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { readLinkParams } from "./local";
import { registerAppCache } from "./offline";
import "./styles.css";

readLinkParams();
registerAppCache();
const root = document.getElementById("root");
if (!root) throw new Error("Missing #root");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

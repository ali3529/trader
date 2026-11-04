import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./globals.css";
import { installBasicAuthFetch } from "./lib/basicAuth";

installBasicAuthFetch();

createRoot(document.getElementById("root")!).render(<App />);

import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";
import { UsualElectricianSettings } from "../src/components/trade/usual-electrician";
import "../src/styles.css";

function Fixture() {
  const [saved, setSaved] = useState(JSON.parse(localStorage.getItem("test-usual-electrician") ?? "null"));
  return <main className="portal-theme mx-auto max-w-lg space-y-4 bg-canvas p-5 text-ink">
    <h1 className="font-display text-2xl font-bold">My business</h1>
    <UsualElectricianSettings saved={saved} onSaved={() => setSaved(JSON.parse(localStorage.getItem("test-usual-electrician") ?? "null"))} />
    <Toaster />
  </main>;
}
const root = document.getElementById("root");
if (root) createRoot(root).render(<Fixture />);
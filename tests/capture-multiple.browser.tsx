import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { CaptureUploads } from "../src/components/owner/CaptureUploads";
import "../src/styles.css";
function Fixture() {
 const [saved, setSaved] = useState<string[]>(JSON.parse(localStorage.getItem("capture-test-files") ?? "[]"));
 return <main className="estimate-brand mx-auto max-w-[620px] bg-estimate-canvas p-6"><CaptureUploads kind="photos" received={saved.length} remaining={5-saved.length} onBusyChange={() => {}} onSaved={async () => {}} uploadFile={async (file) => { const current: string[] = JSON.parse(localStorage.getItem("capture-test-files") ?? "[]"); current.push(file.name); localStorage.setItem("capture-test-files", JSON.stringify(current)); setSaved(current); }}/><section aria-label="Saved test evidence"><h2>Saved test evidence</h2>{saved.map((name,index) => <p key={index}>{name}</p>)}</section></main>;
}
const root = document.getElementById("root");
if (root) createRoot(root).render(<Fixture/>);

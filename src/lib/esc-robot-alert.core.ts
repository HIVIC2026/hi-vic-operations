// The email to the office when the Registry robot could not lodge. Plain words only: no error text, no login, no Registry link.
import type { RobotTask } from "./esc-registry-robot.core";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const NEXT_STEP: Record<RobotTask, string> = {
  install_notification: "Lodge it by hand in the VEU Registry from the Registry block on the job, 24 hours to 5 days before the install.",
  veec_creation: "Create them by hand from Final check.",
};
const WHAT: Record<RobotTask, string> = { install_notification: "install notice", veec_creation: "VEECs" };

export function robotAlertContent(x: { jobNumber: string; address: string | null; task: RobotTask; step: string; jobUrl: string }): { subject: string; text: string; html: string } {
  const intro = `The robot couldn't lodge the ${WHAT[x.task]} for this job.`;
  const lines: [string, string][] = [["Job", x.jobNumber], ...(x.address ? [["Address", x.address] as [string, string]] : []), ["It stopped at", x.step.replace(/_/g, " ")]];
  const next = NEXT_STEP[x.task];
  return {
    subject: `Robot couldn't lodge – ${x.jobNumber} (${WHAT[x.task]})`,
    text: [intro, "", ...lines.map(([k, v]) => `${k}: ${v}`), "", next, "", `Open the job: ${x.jobUrl}`].join("\n"),
    html: `<p>${esc(intro)}</p><p>${lines.map(([k, v]) => `${esc(k)}: ${esc(v)}`).join("<br>")}</p><p>${esc(next)}</p><p><a href="${esc(x.jobUrl)}">Open the job</a></p>`,
  };
}

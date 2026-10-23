export function testQuoteNotification(jobNumber: string, total: number, url: string) {
  if (!Number.isFinite(total) || total < 0 || !url.startsWith("https://")) throw new Error("TEST quote total or link is unavailable.");
  const amount = total.toLocaleString("en-AU", { style: "currency", currency: "AUD" });
  const subject = `[TEST] ${jobNumber} quote — ${amount} inc GST`;
  const text = `[TEST] Your Home Insulation Victoria ceiling insulation quote for ${jobNumber} is ${amount} inc GST after the VEU rebate. View your quote: ${url}`;
  const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return { subject, text, html: `<p>[TEST] Your Home Insulation Victoria ceiling insulation quote for ${escape(jobNumber)} is <strong>${amount} inc GST</strong> after the VEU rebate.</p><p><a href="${escape(url)}">View your quote</a></p>` };
}
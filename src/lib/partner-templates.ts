// Canonical reusable partner invitation templates for the office.
// Presentation only: preview / copy subject / download. Nothing here sends email,
// configures Resend, or triggers any automation. HTML is stored verbatim (canonical),
// with the logo embedded as a data-URI PNG so the file is fully standalone.

export type PartnerTemplate = {
  key: string;
  label: string;
  subject: string;
  registrationUrl: string;
  fileName: string;
  html: string;
};

export const INSTALLER_TEMPLATE: PartnerTemplate = {
  key: "installer_invitation",
  label: "Installer partnership invitation",
  subject: "Hundreds of homeowner enquiries—and we’re looking for great installers",
  registrationUrl: "https://estimate.homeinsulationvictoria.com.au/installer-onboarding",
  fileName: "installer-partnership-invitation.html",
  html: `<!doctype html>
<html lang="en-AU" dir="ltr" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="x-apple-disable-message-reformatting"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>Hundreds of enquiries. Join our installer network.</title>
<!--[if mso]><xml><o:OfficeDocumentSettings><o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
<style>
@import url('https://fonts.googleapis.com/css2?family=Figtree:wght@400;600;700;800&family=Outfit:wght@500;600;700&display=swap');
body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;} table,td{mso-table-lspace:0pt;mso-table-rspace:0pt;} img{border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;} body{margin:0;padding:0;background:#F3F6F2;} a{color:#3C51C4;} .email{width:100%;max-width:620px;} .outer{padding:28px 12px;} .pad{padding-left:40px;padding-right:40px;} .headline{font-size:43px;line-height:47px;letter-spacing:-1.1px;} .logo{width:190px;height:auto;}
@media only screen and (max-width:600px){.outer{padding:0!important;}.pad{padding-left:24px!important;padding-right:24px!important;}.headline{font-size:35px!important;line-height:39px!important;letter-spacing:-.7px!important;}.logo{width:164px!important;}.invitation{font-size:10px!important;letter-spacing:1.2px!important;}}
</style></head>
<body style="margin:0;padding:0;background:#F3F6F2;font-family:Figtree,Arial,Helvetica,sans-serif;color:#22376B;">
<div lang="en-AU" dir="ltr" style="display:none;font-size:1px;line-height:1px;color:#F3F6F2;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">Work with our homeowner enquiries, bring your own customers, or do both. No lead fees.</div>
<table lang="en-AU" dir="ltr" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#F3F6F2;"><tr><td class="outer" align="center">
<!--[if mso]><table role="presentation" width="620" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table class="email" role="presentation" width="620" align="center" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:620px;margin:0 auto;background:#FFFFFF;">
<tr><td style="height:5px;line-height:5px;background:#3C51C4;font-size:0;">&nbsp;</td></tr>
<tr><td class="pad" style="padding:29px 40px 25px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;"><tr><td valign="middle"><img class="logo" src="data:image/png;base64,__LOGO_B64__" width="190" height="81" alt="Home Insulation Victoria" style="display:block;width:190px;max-width:100%;height:auto;"></td><td valign="middle" align="right" style="font-family:Figtree,Arial,Helvetica,sans-serif;color:#22376B;font-size:11px;line-height:17px;font-weight:700;letter-spacing:1.4px;color:#4A5578;">TRADE<br>PARTNERS</td></tr></table>
</td></tr>
<tr><td class="pad" style="padding:8px 40px 0;">
<span class="invitation" style="display:inline-block;background:#FFDDEB;color:#22376B;padding:7px 10px;font-size:11px;line-height:14px;letter-spacing:1.5px;font-weight:800;">INSTALLER PARTNER INVITATION</span>
<h1 class="headline" style="font-family:Outfit,Figtree,Arial,sans-serif;font-size:43px;line-height:47px;letter-spacing:-1.1px;font-weight:600;margin:18px 0 8px;color:#22376B;">Hundreds of<br>homeowner enquiries.</h1>
<p style="font-family:Outfit,Figtree,Arial,sans-serif;font-size:27px;line-height:33px;font-weight:600;color:#3C51C4;margin:0 0 19px;">Let’s work together.</p>
<p style="font-size:18px;line-height:28px;margin:0 0 15px;font-family:Figtree,Arial,Helvetica,sans-serif;color:#22376B;">We’re growing our installer network across Victoria—and we’d love your business to be part of it.</p>
<p style="font-size:16px;line-height:25px;color:#4A5578;margin:0 0 25px;">Take on suitable enquiries from us, bring your own customers, or do both. Work with Home Insulation Victoria as your Accredited Person for eligible Victorian Energy Upgrades (VEU) ceiling insulation jobs.</p>
</td></tr>
<tr><td class="pad" style="padding:0 40px;">
<h2 style="font-family:Outfit,Figtree,Arial,sans-serif;font-size:23px;line-height:29px;margin:0 0 3px;font-weight:600;color:#22376B;">The opportunity for your business</h2>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;"><tr><td width="30" valign="top" style="width:30px;padding:12px 0;border-bottom:1px solid #E6EBE7;font-size:21px;color:#008A45;font-family:Arial,sans-serif;">&#10003;</td><td valign="top" style="padding:12px 0;border-bottom:1px solid #E6EBE7;font-family:Figtree,Arial,Helvetica,sans-serif;color:#22376B;"><p style="margin:0 0 3px;font-size:17px;line-height:23px;font-weight:700;">We bring you enquiries</p><p style="margin:0;font-size:15px;line-height:23px;color:#4A5578;">We pre-screen enquiries. Your team provides a free Ready Check (measure-up and site evidence), then installs approved jobs at agreed supplier rates.</p></td></tr><tr><td width="30" valign="top" style="width:30px;padding:12px 0;border-bottom:1px solid #E6EBE7;font-size:21px;color:#008A45;font-family:Arial,sans-serif;">&#10003;</td><td valign="top" style="padding:12px 0;border-bottom:1px solid #E6EBE7;font-family:Figtree,Arial,Helvetica,sans-serif;color:#22376B;"><p style="margin:0 0 3px;font-size:17px;line-height:23px;font-weight:700;">You bring your own customers</p><p style="margin:0;font-size:15px;line-height:23px;color:#4A5578;">You set your installation price. Our fees and the VEU discount are shown separately in the customer quote.</p></td></tr><tr><td width="30" valign="top" style="width:30px;padding:12px 0;border-bottom:1px solid #E6EBE7;font-size:21px;color:#008A45;font-family:Arial,sans-serif;">&#10003;</td><td valign="top" style="padding:12px 0;border-bottom:1px solid #E6EBE7;font-family:Figtree,Arial,Helvetica,sans-serif;color:#22376B;"><p style="margin:0 0 3px;font-size:17px;line-height:23px;font-weight:700;">Your preferred electrician—or ours</p><p style="margin:0;font-size:15px;line-height:23px;color:#4A5578;">Nominate your Registered Electrical Contractor (REC) for approval, or use an approved electrician from our network.</p></td></tr></table>
</td></tr>
<tr><td class="pad" style="padding:24px 40px 0;">
<p style="font-size:16px;line-height:25px;margin:0 0 20px;color:#4A5578;"><strong style="color:#22376B;">No lead fees.</strong> We manage the rebate process and coordinate customer paperwork and electrical assessment requirements. <strong style="color:#22376B;">You bring the installation expertise.</strong></p>
<h2 style="font-family:Outfit,Figtree,Arial,sans-serif;font-size:23px;line-height:29px;font-weight:600;color:#22376B;margin:0 0 10px;">Your coverage. Your capacity. Your rates.</h2>
<p style="font-size:16px;line-height:25px;margin:0 0 20px;color:#4A5578;">For work we bring you, tell us your coverage, capacity and best supplier rates. <strong style="color:#22376B;background:#FFDDEB;">Sharper rates help more homeowners proceed</strong>—creating more opportunities to work together.</p>
</td></tr>
<tr><td class="pad" style="padding:0 40px 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;"><tr><td align="center" bgcolor="#3C51C4" style="background:#3C51C4;border-radius:8px;mso-padding-alt:18px 20px;">
<a href="__REG_URL__" style="display:block;padding:18px 18px;border:1px solid #3C51C4;border-radius:8px;font-family:Figtree,Arial,Helvetica,sans-serif;color:#22376B;font-size:15px;line-height:22px;font-weight:800;letter-spacing:.4px;text-decoration:none;color:#FFFFFF;text-align:center;">JOIN OUR INSTALLER NETWORK&nbsp; &#8594;</a>
</td></tr></table>
<p style="font-size:14px;line-height:21px;text-align:center;color:#4A5578;margin:12px 0 0;">Have your ABN, insurance certificate<br>and your team’s training / certification details ready.</p>
<p style="font-size:16px;line-height:25px;margin:24px 0 0;color:#4A5578;"><strong style="color:#22376B;">We’re looking for installers we can keep coming back to.</strong> Prompt responses, dependable attendance and same-day submission of signed installer safety forms and installation evidence are essential.</p>
<p style="font-size:14px;line-height:21px;color:#4A5578;margin:22px 0 16px;">Register your business, nominate your team and review the partner agreement. We’ll confirm approval and agreed rates before allocating work. Opportunities depend on demand, coverage and availability.</p>
<p style="font-size:14px;line-height:22px;margin:0 0 24px;"><a href="https://www.energy.vic.gov.au/victorian-energy-upgrades/installers/insulation-requirements-for-industry" style="color:#3C51C4;text-decoration:underline;">View the official VEU insulation requirements&nbsp; &#8599;</a></p>
<p style="font-size:16px;line-height:25px;margin:0 0 24px;color:#22376B;">Kind regards,<br><strong>Joannah</strong><br>Home Insulation Victoria</p>
</td></tr>
<tr><td class="pad" style="padding:20px 40px;background:#F1F7F2;border-top:1px solid #DDE9DF;">
<p style="font-size:15px;line-height:23px;margin:0;color:#22376B;"><strong>Know another great installer?</strong><br>Forward this invitation. We’re welcoming interest from across Victoria.</p>
</td></tr>
<tr><td class="pad" style="padding:21px 40px 27px;">
<p style="font-size:14px;line-height:21px;color:#4A5578;margin:0;">DC Construction Solutions Pty Ltd<br>ABN 44 671 613 979<br>Trading as Home Insulation Victoria</p>
<p style="font-size:14px;line-height:21px;color:#4A5578;margin:12px 0 0;">Prefer not to receive partnership invitations? Reply “unsubscribe”.</p>
</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table>
</body></html>`,
};

export const PARTNER_TEMPLATES: PartnerTemplate[] = [INSTALLER_TEMPLATE];

/** Final standalone HTML with the embedded logo and registration link substituted in. */
export function renderPartnerTemplate(t: PartnerTemplate, logoBase64: string): string {
  return t.html.replace("__LOGO_B64__", logoBase64).replaceAll("__REG_URL__", t.registrationUrl);
}

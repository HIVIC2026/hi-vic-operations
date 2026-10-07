"""Builds the bulk-upload test files for the installer test (TEST customers only, @hivic-test.example emails).
Usage: python3 fixtures.py <outDir> <runTag>"""
import csv, sys
from pathlib import Path
from PIL import Image, ImageDraw
from openpyxl import Workbook

out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True); tag = sys.argv[2]
H = ["Customer name", "Mobile", "Email", "Address", "Suburb", "Postcode", "Ceiling m2", "Quoted price inc GST", "Price includes", "Site check done", "Site check date"]
def row(i, **k):
    r = {"Customer name": f"TEST {tag} Owner {i}", "Mobile": f"04{(12000000 + i * 7919) % 100000000:08d}", "Email": f"qa.owner.{tag.lower()}.{i}@hivic-test.example",
         "Address": f"{10 + i} Testing St", "Suburb": "Fraser Rise", "Postcode": "3336", "Ceiling m2": str(80 + i % 60), "Quoted price inc GST": f"{2500 + i * 11}.00",
         "Price includes": "R5 batts supply and install", "Site check done": "Yes", "Site check date": "2026-10-01"}
    r.update(k); return r
def write_csv(name, rows, header=H):
    with open(out / name, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=header, extrasaction="ignore"); w.writeheader(); w.writerows(rows)

write_csv("plain.csv", [row(1), row(2, **{"Site check done": "No", "Site check date": "", "Quoted price inc GST": ""}), row(3, **{"Site check done": "", "Site check date": ""})])
wb = Workbook(); ws = wb.active; ws.append(H)
for r in [row(11), row(12, **{"Quoted price inc GST": "3,187.55"})]: ws.append([r[h] for h in H])
wb.save(out / "list.xlsx")
write_csv("messy.csv", [{"Name": f"TEST {tag} Messy 1", "Phone": "0412 555 001", "Where": "5 Messy Rd Fraser Rise 3336"}, {"Name": f"TEST {tag} Messy 2", "Phone": "", "Where": ""}], header=["Name", "Phone", "Where"])
write_csv("duplicates.csv", [row(21), row(21), row(22)])
write_csv("bad-email.csv", [row(31, Email=f"qa.owner.{tag.lower()}.31@gmai.com")])
write_csv("missing-address.csv", [row(41, Address="", Suburb="", Postcode="")])
write_csv("large.csv", [row(100 + i) for i in range(200)])

def page(lines, size=(1240, 1754)):
    im = Image.new("RGB", size, "white"); d = ImageDraw.Draw(im); y = 80
    for ln in lines: d.text((80, y), ln, fill="black"); y += 40
    return im
quotes = [page([f"QUOTE Q-{tag}-{i}", f"Customer: TEST {tag} Quote {i}", f"Email: qa.owner.{tag.lower()}.q{i}@hivic-test.example", f"Mobile: 04120000{i:02d}",
                f"Site: {60 + i} Quote Ave, Fraser Rise VIC 3336", "Measured ceiling area: 112 m2 (measured on site 02/10/2026)", "R5.0 ceiling batts supply and install",
                f"TOTAL inc GST: ${3000 + i}.00"]) for i in (1, 2)]
quotes[0].save(out / "quotes.pdf", save_all=True, append_images=quotes[1:])
ceiling = Image.new("RGB", (800, 600), (150, 120, 90)); dd = ImageDraw.Draw(ceiling)
for x in range(0, 800, 60): dd.line([(x, 0), (x + 200, 600)], fill=(90, 70, 50), width=8)
ceiling.save(out / "ceiling-1.jpg"); ceiling.rotate(8).save(out / "ceiling-2.jpg")
notes = page([f"Leads from the weekend - {tag}", f"TEST {tag} Notes Owner rang about insulation, lives at 77 Sentence St, Fraser Rise VIC 3336,",
              f"mobile 0412 777 001, email qa.owner.{tag.lower()}.n1@hivic-test.example. Haven't been out yet."])
notes.save(out / "photos-and-sentences.pdf", save_all=True, append_images=[ceiling.convert("RGB")])
print("ok")

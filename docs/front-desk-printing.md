# Front-desk printing without the print dialog

*For whoever sets up a clinic's reception computer. Written 2026-10-15.*

FlexicaAI's **Print A4 / Print thermal** buttons print a document without opening its
print page, but the browser still shows its print dialog, where someone presses
**Print** (or Enter). No website can skip that dialog or pick a printer by itself;
browsers forbid it so a website can't print on your printers without asking.

A reception computer can be set up to **skip the dialog** using a Chrome (or Edge)
setting called **kiosk printing**. It is set once per computer and needs nothing from
FlexicaAI.

---

## What it does, and its one limit

- With kiosk printing on, a print goes **straight to the printer**, with no dialog.
- It always goes to **one printer** for that Chrome window: the last printer used in
  that Chrome profile. The page still decides the paper size (A4 or the 80 mm thermal
  roll), but the printer it lands on is fixed.

So it suits a desk with **one printer**, for example the thermal printer at the counter
while the doctor's room prints A4 from another computer. A desk that needs two printers
from the same window should keep the normal dialog. Choosing the printer automatically
by paper size needs a small helper program on the PC (e.g. QZ Tray); ask for it if 1 +
2 aren't enough.

---

## Setup (Windows, about 5 minutes)

We use a **separate Chrome profile** for FlexicaAI, so kiosk printing never affects
anyone's personal browsing on the same computer.

### 1. Make the printer the default

1. **Settings → Bluetooth & devices → Printers & scanners.**
2. Turn **off** "Let Windows manage my default printer".
3. Click the printer the desk uses (e.g. the thermal printer) → **Set as default**.
4. For a thermal printer: open **Printing preferences** and set the paper to the
   **80 mm roll** (often called "80 x 297 mm" or "Roll paper 80").

### 2. Create the FlexicaAI shortcut (first without kiosk printing)

1. Right-click the desktop → **New → Shortcut**.
2. Paste this as the location (one line):
   ```
   "C:\Program Files\Google\Chrome\Application\chrome.exe" --user-data-dir="C:\FlexicaAI-Chrome" https://flexicaai.com/login
   ```
   *(For the test site use `https://test.flexicaai.com/login`. For Edge, use
   `"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"` instead.)*
3. Name it **FlexicaAI**.
4. Open it, sign in, open any invoice and print it **once** the normal way, choosing:
   - **Destination:** the desk's printer;
   - **Margins:** Default;
   - **Headers and footers:** **off** (otherwise the date and web address print on every page).

   Chrome remembers these in this profile, and kiosk printing reuses them.
5. Close that Chrome window **completely** (all its windows).

### 3. Turn kiosk printing on

1. Right-click the **FlexicaAI** shortcut → **Properties**.
2. In **Target**, add ` --kiosk-printing` after `chrome.exe"`, so it reads:
   ```
   "C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk-printing --user-data-dir="C:\FlexicaAI-Chrome" https://flexicaai.com/login
   ```
3. **OK**, then open FlexicaAI from this shortcut.

### 4. Check it

Click **Print thermal** (or **Print A4**) on an invoice. It should print immediately
with no dialog.

---

## If something is off

| Symptom | Fix |
|---|---|
| The dialog still appears | Chrome was already running when the shortcut was used. Close **every** Chrome window (check the system tray), then open from the shortcut. |
| It prints on the wrong printer | Remove `--kiosk-printing`, print once choosing the right printer (step 2.4), close Chrome, add the flag back. |
| A date / web address prints at the top or bottom | Headers and footers were on. Same fix as above, unticking **Headers and footers**. |
| The thermal slip is cut short or very small | Set the printer's paper to the 80 mm roll in **Printing preferences** (step 1.4). |
| Someone needs the dialog back (to pick another printer) | Open FlexicaAI from a normal Chrome window instead of the shortcut. |

**Turning it off:** delete ` --kiosk-printing` from the shortcut's Target, or simply use
a normal Chrome window.

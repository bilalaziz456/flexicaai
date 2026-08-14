/**
 * `core/lib/phone` — one canonical phone form.
 *
 * This matters beyond tidiness: a stored number is matched against the digits an
 * inbound WhatsApp webhook sends, so a patient saved in a format that normalises
 * differently is invisible to inbound messages. Every way of writing one number has
 * to land on the same string.
 */
import { toE164, phoneDigits, sanitisePhoneInput } from "@/core/lib/phone";

let failures = 0;
function check(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) console.log(`  ok   ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}\n       got  ${g}\n       want ${w}`);
  }
}

console.log("One Pakistani mobile, every way it gets typed:");
const SAME = "+923450186120";
for (const raw of [
  "03450186120",
  "923450186120",
  "00923450186120",
  "+923450186120",
  "+92 345-018 6120",
  "0345 018 6120",
  "0092-345-0186120",
  "3450186120",
  "  +92 345 018 6120  ",
]) {
  check(JSON.stringify(raw), toE164(raw).phone, SAME);
}

console.log("\nMatching digits (the shape an inbound webhook sends):");
check("local form matches inbound", phoneDigits("03450186120"), "923450186120");
check("international prefix matches", phoneDigits("00923450186120"), "923450186120");

console.log("\nEmpty and rubbish:");
check("empty is null, not an error", toE164(""), { phone: null, valid: true });
check("whitespace is null", toE164("   "), { phone: null, valid: true });
check("letters only is null", toE164("abc"), { phone: null, valid: true });
check("too short is flagged", toE164("12").valid, false);
check("absurdly long is flagged", toE164("+1234567890123456789").valid, false);

console.log("\nThe field can only hold a number:");
check("spaces and dashes go", sanitisePhoneInput("+92 345-018 6120"), "+923450186120");
check("letters go", sanitisePhoneInput("abc0345x"), "0345");
check("a plus survives only in front", sanitisePhoneInput("++92345"), "+92345");
check("a plus in the middle goes", sanitisePhoneInput("92+345"), "92345");
check("leading zero is preserved for the local form", sanitisePhoneInput("0345 018 6120"), "03450186120");

// The GCC half of the market. A leading 0 is only Pakistani if the clinic is.
console.log("\nCountry code is per clinic, not assumed:");
check("UAE local with its own code", toE164("0501234567", "971").phone, "+971501234567");
check("Saudi local with its own code", toE164("0512345678", "966").phone, "+966512345678");
check("a number already carrying +971 is untouched", toE164("+971501234567", "971").phone, "+971501234567");

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);

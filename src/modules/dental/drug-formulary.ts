import type { Drug } from "@/core/types/module";

/**
 * Dental formulary (Pakistan). AI-suggested prescriptions are validated against
 * this list before being shown to the dentist (CLAUDE.md §8). Not exhaustive —
 * a starting set of commonly prescribed dental medications with local brands.
 * Doses are typical adult starting points; the dentist adjusts and approves.
 */
export const dentalDrugFormulary: Drug[] = [
  {
    name: "Amoxicillin",
    brands: ["Amoxil", "Moxin", "Amoclav"],
    form: "capsule",
    defaultDosage: "500 mg three times daily for 5 days",
    notes: "First-line for odontogenic infection (no penicillin allergy).",
  },
  {
    name: "Amoxicillin + Clavulanic acid",
    brands: ["Augmentin", "Calamox", "Amoclan"],
    form: "tablet",
    defaultDosage: "625 mg three times daily for 5-7 days",
  },
  {
    name: "Metronidazole",
    brands: ["Flagyl", "Metrozine"],
    form: "tablet",
    defaultDosage: "400 mg three times daily for 5 days",
    notes: "Often combined with amoxicillin for anaerobic coverage.",
  },
  {
    name: "Clindamycin",
    brands: ["Dalacin C", "Clindac"],
    form: "capsule",
    defaultDosage: "300 mg three times daily for 5 days",
    notes: "For penicillin-allergic patients.",
  },
  {
    name: "Ibuprofen",
    brands: ["Brufen", "Ibugesic"],
    form: "tablet",
    defaultDosage: "400 mg three times daily after meals",
    notes: "First-line dental analgesia.",
  },
  {
    name: "Paracetamol",
    brands: ["Panadol", "Calpol"],
    form: "tablet",
    defaultDosage: "1 g up to four times daily",
  },
  {
    name: "Mefenamic acid",
    brands: ["Ponstan", "Mefnac"],
    form: "tablet",
    defaultDosage: "500 mg three times daily",
  },
  {
    name: "Diclofenac sodium",
    brands: ["Dicloran", "Voltral"],
    form: "tablet",
    defaultDosage: "50 mg twice daily after meals",
  },
  {
    name: "Chlorhexidine gluconate",
    brands: ["Orahex", "Rebisol"],
    form: "mouthwash",
    defaultDosage: "0.2% rinse twice daily for up to 2 weeks",
  },
];

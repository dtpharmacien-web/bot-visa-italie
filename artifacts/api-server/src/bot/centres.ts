export interface Centre {
  id: string;
  name: string;
  aliases: string[];
}

export const CENTRES: Centre[] = [
  { id: "alger",       name: "Alger (Algiers)",  aliases: ["alger", "algiers", "algerie", "alg"] },
  { id: "constantine", name: "Constantine",       aliases: ["constantine", "cst", "cts"] },
  { id: "oran",        name: "Oran",              aliases: ["oran"] },
  { id: "annaba",      name: "Annaba",            aliases: ["annaba"] },
  { id: "tlemcen",     name: "Tlemcen",           aliases: ["tlemcen"] },
];

export function findCentre(input: string): Centre | undefined {
  const normalized = input.toLowerCase().trim();
  return CENTRES.find(
    (c) =>
      c.id === normalized ||
      c.name.toLowerCase() === normalized ||
      c.aliases.includes(normalized)
  );
}

export function getCentreById(id: string): Centre | undefined {
  return CENTRES.find((c) => c.id === id);
}

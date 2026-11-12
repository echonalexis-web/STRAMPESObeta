const { tidyCitizenship, tidyNamedList, tidyText } = require("../utils/profileText");

test("citizenship: trims, collapses spaces, keeps casing and accents, caps at 50", () => {
  expect(tidyCitizenship("  Filipino   ")).toBe("Filipino");
  expect(tidyCitizenship("Dual   Citizen")).toBe("Dual Citizen");
  expect(tidyCitizenship("Español")).toBe("Español");
  expect(tidyCitizenship("x".repeat(80))).toHaveLength(50);
  expect(tidyCitizenship(null)).toBe("");
});

test("named lists: only `name` is tidied, other fields and entries pass through", () => {
  const input = [
    { name: "  CSE -  Professional   Pen and Paper Test ", rating: "84.81", examDate: "2026-03-08" },
    { name: "", validUntil: "" },
    "not an object",
  ];
  const out = tidyNamedList(input);
  expect(out[0]).toEqual({ name: "CSE - Professional Pen and Paper Test", rating: "84.81", examDate: "2026-03-08" });
  expect(out[1]).toEqual({ name: "", validUntil: "" });
  expect(out[2]).toBe("not an object");
});

test("named lists: a non-array is returned unchanged; names are capped at 120", () => {
  expect(tidyNamedList(null)).toBeNull();
  expect(tidyNamedList({ a: 1 })).toEqual({ a: 1 });
  expect(tidyNamedList([{ name: "y".repeat(300) }])[0].name).toHaveLength(120);
  expect(tidyText("a   b", 10)).toBe("a b");
});

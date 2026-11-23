import { describe, expect, test } from "vitest";
import { buildAtsPdf, extractAtsBlocks, normalizeDates } from "../utils/atsPdf";

const rootWith = (html) => {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
};

const RESUME = `
  <div class="resume-doc__header">
    <img class="resume-doc__photo" src="data:image/png;base64,AAAA" alt="">
    <h2>Ana Cruz</h2>
    <p class="resume-doc__title">Service Crew</p>
    <p class="resume-doc__contact">ana@example.test  ·  0917 000 0000  ·  Boac, Marinduque</p>
  </div>
  <div class="resume-doc__main">
    <div class="resume-doc__section" data-section="summary"><h3>Professional Summary</h3><p>Reliable and quick to learn.</p></div>
    <div class="resume-doc__section" data-section="skills"><h3>Skills</h3><p><mark class="resume-doc__match">Customer Service</mark>, Cooking, Teamwork</p></div>
    <div class="resume-doc__section" data-section="experience"><h3>Work Experience</h3><p>Kitchen helper — Corner Cafe<br>2021-03 – Present</p></div>
    <div class="resume-doc__section" data-section="education" style="display:none;"><h3>Education</h3><p>Hidden one</p></div>
    <div class="resume-doc__section" data-section="languages"><h3>Languages</h3><p></p></div>
  </div>`;

// A jsPDF text string is written into the page content as "(text) Tj"; an image would be an XObject.
const pdfSource = (doc) => new TextDecoder("latin1").decode(new Uint8Array(doc.output("arraybuffer")));

describe("ATS resume PDF", () => {
  test("reads the document in the order the applicant arranged it; hidden and empty sections are left out", () => {
    const blocks = extractAtsBlocks(rootWith(RESUME));
    const headings = blocks.filter((b) => b.type === "heading").map((b) => b.text);
    expect(headings).toEqual(["Professional Summary", "Skills", "Work Experience"]);
    expect(blocks[0]).toEqual({ type: "name", text: "Ana Cruz" });
    expect(blocks[1]).toEqual({ type: "headline", text: "Service Crew" });
    expect(blocks[2].text).toBe("ana@example.test | 0917 000 0000 | Boac, Marinduque");
    expect(blocks.find((b) => b.text === "Customer Service, Cooking, Teamwork")).toBeTruthy();
    expect(blocks.some((b) => /Hidden one/.test(b.text))).toBe(false);
  });

  test("moving a section moves it in the PDF", () => {
    const root = rootWith(RESUME);
    const main = root.querySelector(".resume-doc__main");
    main.appendChild(main.querySelector('[data-section="summary"]'));
    const headings = extractAtsBlocks(root).filter((b) => b.type === "heading").map((b) => b.text);
    expect(headings).toEqual(["Skills", "Work Experience", "Professional Summary"]);
  });

  test("dates are written in one format", () => {
    expect(normalizeDates("2021-03 – Present")).toBe("Mar 2021 – Present");
    expect(normalizeDates("2019-11-30 to 2020/02")).toBe("Nov 2019 to Feb 2020");
    expect(normalizeDates("March 2021")).toBe("March 2021");
  });

  test("the PDF holds real text and no picture: the words are in the file and there is no image", () => {
    const source = pdfSource(buildAtsPdf(extractAtsBlocks(rootWith(RESUME))));
    for (const word of ["Ana Cruz", "Professional Summary", "Work Experience", "Customer Service, Cooking, Teamwork", "Kitchen helper", "Mar 2021"]) {
      expect(source).toContain(`(${word}`);
    }
    expect(source).not.toMatch(/\/Subtype\s*\/Image/);
    // The photo in the editor is never carried over.
    expect(source).not.toContain("AAAA");
  });

  test("a long resume continues on more pages", () => {
    const many = Array.from({ length: 120 }, (_, i) => `<p>Line ${i} of a very long work history entry that goes on and on and on.</p>`).join("");
    const doc = buildAtsPdf(extractAtsBlocks(rootWith(`<div class="resume-doc__header"><h2>Ana</h2></div><div class="resume-doc__section" data-section="experience"><h3>Work Experience</h3>${many}</div>`)));
    expect(doc.getNumberOfPages()).toBeGreaterThan(1);
  });

  test("a character the standard font cannot print becomes ?, never garbage", () => {
    const source = pdfSource(buildAtsPdf([{ type: "para", text: "Rizal → Boac" }]));
    expect(source).toContain("(Rizal ? Boac");
  });
});

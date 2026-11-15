const { classifyUploadPath } = require("../utils/uploadPath");

describe("classifyUploadPath: traversal through a public folder is refused", () => {
  test.each([
    ["/profiles/%2e%2e/ids/x.jpg"],
    ["/profiles/%2E%2E/ids/x.jpg"],
    ["/news/../resumes/x.pdf"],
    ["/profiles/..%2fids/x.jpg"],
    ["/profiles%2f..%2fids/x.jpg"],
    ["/profiles/..%5cids/x.jpg"],
    ["/profiles\\..\\ids\\x.jpg"],
    ["/covers/../../server.js"],
    ["/.."],
  ])("%s", (rawPath) => {
    expect(classifyUploadPath(rawPath)).toEqual({ ok: false });
  });

  test("malformed percent-encoding is refused", () => {
    expect(classifyUploadPath("/profiles/%E0%A4%A")).toEqual({ ok: false });
  });

  test("a NUL byte is refused", () => {
    expect(classifyUploadPath("/profiles/a.webp%00.pdf")).toEqual({ ok: false });
  });
});

describe("classifyUploadPath: public and private folders", () => {
  test.each([
    ["/profiles/a.webp"],
    ["/news/n.jpg"],
    ["/covers/c.webp"],
    ["/banner-templates/b.webp"],
    ["/avatar-presets/p.webp"],
  ])("%s is public", (rawPath) => {
    expect(classifyUploadPath(rawPath)).toEqual({ ok: true, normalized: rawPath, isPublic: true });
  });

  test.each([
    ["/ids/x.jpg"],
    ["/resumes/r.pdf"],
    ["/jobseeker-documents/resumes/r.pdf"],
    // A public folder name deeper in the path no longer exempts the request.
    ["/ids/profiles/x.jpg"],
    ["/x/news/y.jpg"],
  ])("%s is private", (rawPath) => {
    expect(classifyUploadPath(rawPath)).toEqual({ ok: true, normalized: rawPath, isPublic: false });
  });

  test("double-encoded dots stay a literal folder name, not a traversal", () => {
    const result = classifyUploadPath("/profiles/%252e%252e/ids/x.jpg");
    expect(result).toEqual({ ok: true, normalized: "/profiles/%2e%2e/ids/x.jpg", isPublic: true });
  });

  test("redundant slashes and dot segments are normalised before the public check", () => {
    expect(classifyUploadPath("//profiles/./a.webp")).toEqual({ ok: true, normalized: "/profiles/a.webp", isPublic: true });
    expect(classifyUploadPath("/./ids//x.jpg")).toEqual({ ok: true, normalized: "/ids/x.jpg", isPublic: false });
  });
});

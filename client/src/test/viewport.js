// jsdom has no layout: this gives window.matchMedia a width to answer
// (max-width / min-width queries) so components that switch layout through
// useMediaQuery can be tested at a phone or a desktop width.
let width = 1280

const matches = (query) => {
  const max = query.match(/max-width:\s*(\d+)px/)
  const min = query.match(/min-width:\s*(\d+)px/)
  if (max && width > Number(max[1])) return false
  if (min && width < Number(min[1])) return false
  return Boolean(max || min)
}

export function setViewport(next) {
  width = next
  window.innerWidth = next
  window.matchMedia = (query) => ({
    matches: matches(query),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })
}

export const resetViewport = () => setViewport(1280)

resetViewport()

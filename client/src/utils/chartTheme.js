// Shared Recharts styling so every chart uses the brand palette and the same
// axis/grid/tooltip treatment. Hex values mirror --ds-chart-* and the neutral
// tokens in styles/design-system-app.css (SVG attributes cannot read CSS
// variables reliably, so the values are repeated here on purpose).

export const CHART_SERIES = [
  '#07553a', // --ds-chart-1 forest green
  '#e6b91e', // --ds-chart-2 gold
  '#0b704b', // --ds-chart-3 secondary green
  '#7fb89a', // --ds-chart-4 soft green
  '#5a6c65', // --ds-chart-5 ink
  '#b42318', // --ds-chart-6 danger
]

// Status colors keep their semantic hue but use AA-safe values.
export const CHART_STATUS = {
  pending: '#a07a00',
  reviewed: '#1d5a8f',
  shortlisted: '#6b3fa0',
  rejected: '#b42318',
  hired: '#1c6b3a',
}

export const CHART_AXIS = { stroke: '#5a6c65', fontSize: 12 }
export const CHART_GRID = { stroke: '#e6ede9', strokeDasharray: '3 3' }
export const CHART_TOOLTIP = {
  contentStyle: {
    background: '#ffffff',
    border: '1px solid #dfe8e3',
    borderRadius: 12,
    boxShadow: '0 8px 24px rgba(4, 60, 42, 0.1)',
    color: '#10271f',
    fontSize: 13,
  },
  cursor: { fill: 'rgba(7, 85, 58, 0.06)' },
}

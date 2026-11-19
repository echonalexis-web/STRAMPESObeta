import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import '../i18n'
import { resetViewport } from './viewport'

afterEach(() => {
  cleanup()
  resetViewport()
})

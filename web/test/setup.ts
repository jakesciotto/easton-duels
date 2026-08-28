import { expect, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import * as matchers from '@testing-library/jest-dom/matchers'

expect.extend(matchers)
afterEach(cleanup)

// jsdom ships no PointerEvent, and base-ui dispatches one when a radio is activated.
if (!('PointerEvent' in globalThis)) {
  globalThis.PointerEvent = class extends MouseEvent {} as typeof globalThis.PointerEvent
}

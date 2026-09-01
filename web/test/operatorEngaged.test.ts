import { describe, it, expect, afterEach } from 'vitest'
import { operatorEngaged } from '@/lib/operatorEngaged'

afterEach(() => {
  document.body.innerHTML = ''
  ;(document.activeElement as HTMLElement | null)?.blur()
})

describe('operatorEngaged', () => {
  it('is false with nothing in progress', () => {
    expect(operatorEngaged()).toBe(false)
  })

  it('is true while a tab root is mid drag', () => {
    document.body.innerHTML = '<div data-dragging="1"></div>'
    expect(operatorEngaged()).toBe(true)
  })

  it('is false when data-dragging is explicitly false', () => {
    document.body.innerHTML = '<div data-dragging="false"></div>'
    expect(operatorEngaged()).toBe(false)
  })

  it('is true while an input is focused', () => {
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    expect(operatorEngaged()).toBe(true)
  })

  it('is true while a select is focused', () => {
    const select = document.createElement('select')
    document.body.appendChild(select)
    select.focus()
    expect(operatorEngaged()).toBe(true)
  })

  it('is false while a plain button is focused', () => {
    const button = document.createElement('button')
    document.body.appendChild(button)
    button.focus()
    expect(operatorEngaged()).toBe(false)
  })

  it('is true while a dialog is open', () => {
    document.body.innerHTML = '<div data-slot="dialog-content" data-open=""></div>'
    expect(operatorEngaged()).toBe(true)
  })

  it('is true while the app Select trigger is focused', () => {
    document.body.innerHTML = '<button data-slot="select-trigger"></button>'
    const trigger = document.querySelector('button')!
    trigger.focus()
    expect(operatorEngaged()).toBe(true)
  })

  it('is true while a Select listbox is open, even if focus has moved to an item', () => {
    document.body.innerHTML = '<div role="listbox"><div role="option" tabindex="0"></div></div>'
    const option = document.querySelector('[role="option"]') as HTMLElement
    option.focus()
    expect(operatorEngaged()).toBe(true)
  })
})

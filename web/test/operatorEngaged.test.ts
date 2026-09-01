import { describe, it, expect, afterEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { ENGAGEMENT_RECHECK_MS, operatorEngaged, useHeldWhileEngaged } from '@/lib/operatorEngaged'

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

// 4.4's held commit is one mechanism for both data paths, so its own contract is pinned
// here rather than only through the two hooks that use it.
describe('useHeldWhileEngaged', () => {
  const settle = async (ms: number) => { await act(async () => { await new Promise(r => setTimeout(r, ms)) }) }

  it('passes a value straight through while nobody is engaged', async () => {
    const { result, rerender } = renderHook(({ v }) => useHeldWhileEngaged(v, 'e1'), { initialProps: { v: 'a' } })
    rerender({ v: 'b' })
    await settle(0)
    expect(result.current).toBe('b')
  })

  it('holds while engaged and releases the newest arrival on the first free recheck', async () => {
    const input = document.createElement('input')
    document.body.appendChild(input)
    const { result, rerender } = renderHook(({ v }) => useHeldWhileEngaged(v, 'e1'), { initialProps: { v: 'a' } })
    await settle(0)
    input.focus()
    rerender({ v: 'b' })
    rerender({ v: 'c' })
    await settle(ENGAGEMENT_RECHECK_MS * 2)
    expect(result.current).toBe('a')

    input.blur()
    await settle(ENGAGEMENT_RECHECK_MS * 2)
    expect(result.current).toBe('c')
  })

  it('commits at once when the subject changes, so one event never shows another one data', async () => {
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    const { result, rerender } = renderHook(
      ({ v, k }) => useHeldWhileEngaged(v, k),
      { initialProps: { v: 'event one', k: 'e1' } },
    )
    await settle(0)
    rerender({ v: 'event two', k: 'e2' })
    expect(result.current).toBe('event two')
  })

  it('never holds the first arrival, which would keep a screen on its loading state', async () => {
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    const { result, rerender } = renderHook(
      ({ v }) => useHeldWhileEngaged(v, 'e1'),
      { initialProps: { v: undefined as string | undefined } },
    )
    rerender({ v: 'first' })
    expect(result.current).toBe('first')
  })

  it('stops rechecking when it unmounts', async () => {
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    const spy = vi.spyOn(globalThis, 'clearInterval')
    const { rerender, unmount } = renderHook(({ v }) => useHeldWhileEngaged(v, 'e1'), { initialProps: { v: 'a' } })
    await settle(0)
    rerender({ v: 'b' })
    await settle(0)
    unmount()
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})

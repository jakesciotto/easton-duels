import { describe, it, expect, afterEach, vi } from 'vitest'
import os from 'node:os'
import { lanIp } from '../src/lib/lanIp.js'

afterEach(() => vi.restoreAllMocks())

function v4(address: string, internal = false): os.NetworkInterfaceInfo {
  return { address, netmask: '255.255.255.0', family: 'IPv4', mac: '00:00:00:00:00:00', internal, cidr: `${address}/24` }
}

describe('lanIp', () => {
  it('prefers a private LAN address over a Tailscale one, and keeps interface order within a class', () => {
    vi.spyOn(os, 'networkInterfaces').mockReturnValue({
      utun3: [v4('100.77.152.125')],
      en0: [v4('192.168.4.20')],
      en1: [v4('10.0.0.5')],
    })
    expect(lanIp()).toBe('192.168.4.20')
  })

  it('falls back to a Tailscale address when that is all there is', () => {
    vi.spyOn(os, 'networkInterfaces').mockReturnValue({
      lo0: [v4('127.0.0.1', true)],
      utun3: [v4('100.77.152.125')],
    })
    expect(lanIp()).toBe('100.77.152.125')
  })

  it('returns loopback when no usable address exists', () => {
    vi.spyOn(os, 'networkInterfaces').mockReturnValue({
      lo0: [v4('127.0.0.1', true)],
      en0: [v4('169.254.10.5')],
    })
    expect(lanIp()).toBe('127.0.0.1')
  })
})

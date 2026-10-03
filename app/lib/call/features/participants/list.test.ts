import { describe, expect, it } from 'vitest'
import { filterParticipants, searchKey, sortParticipants, type ListParticipant } from './list'

const p = (
  name: string,
  role: ListParticipant['role'] = 'participant',
  handRaisedAt: number | null = null,
  identity = `p_${name
    .replace(/[^A-Za-z]/g, '')
    .padEnd(16, '0')
    .slice(0, 16)}`,
): ListParticipant => ({ identity, name, role, isLocal: false, handRaisedAt })

describe('sortParticipants', () => {
  it('splits host, co-hosts and everyone else, each by name', () => {
    const sections = sortParticipants([
      p('zoe'),
      p('Bob', 'cohost'),
      p('Hana', 'host'),
      p('adam'),
      p('Alice', 'cohost'),
      p('Mia'),
    ])
    expect(sections.host.map((x) => x.name)).toEqual(['Hana'])
    expect(sections.cohosts.map((x) => x.name)).toEqual(['Alice', 'Bob'])
    expect(sections.others.map((x) => x.name)).toEqual(['adam', 'Mia', 'zoe'])
    expect(sections.hands).toEqual([])
  })

  it('puts raised hands first in queue order and keeps them in their role section', () => {
    const sections = sortParticipants([
      p('Cleo', 'participant', 30),
      p('Ben', 'cohost', 10),
      p('Ana', 'participant', 20),
    ])
    expect(sections.hands.map((e) => [e.position, e.participant.name])).toEqual([
      [1, 'Ben'],
      [2, 'Ana'],
      [3, 'Cleo'],
    ])
    expect(sections.others.map((x) => x.name)).toEqual(['Ana', 'Cleo'])
    expect(sections.cohosts.map((x) => x.name)).toEqual(['Ben'])
  })

  it('sorts non-ASCII names with localeCompare', () => {
    // Emile, Zoe and Asa with diacritics: accents sort with their base letter.
    const sections = sortParticipants([
      p('Zo\u00eb', 'participant', null, 'p_1'),
      p('\u00c9mile', 'participant', null, 'p_2'),
      p('eve', 'participant', null, 'p_3'),
      p('\u00c5sa', 'participant', null, 'p_4'),
    ])
    expect(sections.others.map((x) => x.name)).toEqual(['\u00c5sa', '\u00c9mile', 'eve', 'Zo\u00eb'])
  })

  it('orders equal names by identity (stable across clients)', () => {
    const sections = sortParticipants([p('Sam', 'participant', null, 'p_b'), p('Sam', 'participant', null, 'p_a')])
    expect(sections.others.map((x) => x.identity)).toEqual(['p_a', 'p_b'])
  })
})

describe('filterParticipants', () => {
  // Cyrillic names (Anna, Boris) and a full-width Latin name, written as escapes.
  const people = [
    p('Ana Lima', 'participant', null, 'p_1'),
    p('\u0410\u043d\u043d\u0430', 'participant', null, 'p_2'),
    p('\u0411\u043e\u0440\u0438\u0441', 'cohost', null, 'p_3'),
    p('\uff2d\uff49\uff41', 'participant', null, 'p_4'),
  ]

  it('returns everyone for an empty or blank query', () => {
    expect(filterParticipants(people, '')).toHaveLength(4)
    expect(filterParticipants(people, '   ')).toHaveLength(4)
  })

  it('matches case-insensitively and trims the query', () => {
    expect(filterParticipants(people, '  LIMA ').map((x) => x.identity)).toEqual(['p_1'])
  })

  it('matches non-ASCII names case-insensitively', () => {
    expect(filterParticipants(people, '\u0430\u043d').map((x) => x.identity)).toEqual(['p_2'])
    expect(filterParticipants(people, '\u0411\u041e\u0420').map((x) => x.identity)).toEqual(['p_3'])
  })

  it('NFKC-normalizes both sides', () => {
    expect(filterParticipants(people, 'mia').map((x) => x.identity)).toEqual(['p_4'])
    expect(searchKey('\uff21\uff22')).toBe('ab')
  })

  it('finds nobody for an unknown name', () => {
    expect(filterParticipants(people, 'zzz')).toEqual([])
  })
})

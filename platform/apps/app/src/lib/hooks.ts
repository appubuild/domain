import { useQuery } from '@tanstack/react-query';
import { apiGet } from './api';
import type { Character, Skill, Template } from './types';

/** Small shared queries used by several pages. */
export function useInstalledStatus() {
  return useQuery({
    queryKey: ['installed'],
    queryFn: async () => {
      const [skills, templates] = await Promise.all([apiGet<{ skills: Skill[] }>('/skills'), apiGet<{ templates: Template[] }>('/characters/templates')]);
      return { skills: skills.skills.filter((s) => s.origin === 'builtin').length, templates: templates.templates.length };
    },
    staleTime: 5 * 60_000,
  });
}

export function useCharacters() {
  return useQuery({ queryKey: ['characters'], queryFn: () => apiGet<{ characters: Character[]; defaultId: string | null }>('/characters') });
}

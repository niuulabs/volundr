import type { SlashCommand } from './types';

export function buildCommandList(slashCommands: string[], skills: string[]): SlashCommand[] {
  const cmds: SlashCommand[] = slashCommands.map(name => ({ name, type: 'command' }));
  const skillCmds: SlashCommand[] = skills.map(name => ({ name, type: 'skill' }));
  return [...cmds, ...skillCmds];
}

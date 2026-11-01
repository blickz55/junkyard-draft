// The migrations in order. A new one is a new numbered file and a line here; an applied one never changes (server/community.ts).
import * as community from './0001-community';
import * as deviceKeys from './0002-device-keys';
import * as moderation from './0003-moderation';

export const MIGRATIONS = [
  { version: 1, name: 'community', ...community },
  { version: 2, name: 'device-keys', ...deviceKeys },
  { version: 3, name: 'moderation', ...moderation },
];

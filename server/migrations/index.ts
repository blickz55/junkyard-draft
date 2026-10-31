// The migrations in order. A new one is a new numbered file and a line here; an applied one never changes (server/community.ts).
import * as community from './0001-community';

export const MIGRATIONS = [{ version: 1, name: 'community', ...community }];
